"""Badge engine + walker routes against mongomock (no MongoDB needed).

Run from backend/:  python -m unittest discover -s app/gamification/tests -t . -v
Needs mongomock (dev only):  pip install mongomock
"""
import json
import unittest
from datetime import datetime, timedelta
from unittest import mock

import mongomock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gamification import engine, routes

# Naive UTC, like pymongo returns. 10:00 UTC = 11:00 in Dublin (IST) on 4 Oct.
T0 = datetime(2026, 10, 4, 10, 0)
LON, LAT = -6.2610, 53.3490  # Middle Abbey St
PHASH = "c3c3c3c33c3c3c3c"


def offset(lon: float, lat: float, metres_north: float) -> tuple[float, float]:
    return lon, lat + metres_north / 111_195.0


def flip_bits(h: str, n: int) -> str:
    return f"{int(h, 16) ^ ((1 << n) - 1):016x}"


class Base(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient().homesabove
        self.db.walkers.insert_one({"_id": "w_a", "name": "A", "town": "Dublin"})
        self.db.walkers.insert_one({"_id": "w_b", "name": "B", "town": "Dublin"})

    def capture(self, bid, walker="w_a", at=T0, street="Middle Abbey Street", phash=PHASH,
                pos=(LON, LAT), walk_id=None, **extra):
        """A captured building plus its walk entry, like import_walk.py writes them."""
        walk_id = walk_id or f"{walker}_walk"
        self.db.buildings.insert_one({
            "_id": bid, "street": street, "location": {"type": "Point", "coordinates": list(pos)},
            "captured_by": walker, "captured_at": at, "walk_id": walk_id, "phash": phash,
            "photo": f"/photos/{bid}.jpg", **extra})
        self.db.walks.update_one({"_id": walk_id}, {
            "$set": {"walker_id": walker},
            "$min": {"started_at": at}, "$max": {"ended_at": at},
            "$push": {"building_ids": bid,
                      "captures": {"building_id": bid, "lon": pos[0], "lat": pos[1], "t": at}},
            "$setOnInsert": {"distance_m": 0.0}}, upsert=True)

    def ids(self, awards):
        return sorted(a["badge_id"] for a in awards)


class StatsTest(Base):
    def test_stats(self):
        self.capture("a1", at=T0, upper_floors=3)
        self.capture("a2", at=T0 + timedelta(minutes=30), street="Talbot Street", upper_floors=2)
        # 23:30 UTC on 4 Oct is 00:30 on 5 Oct in Dublin: a second capture day.
        self.capture("a3", at=datetime(2026, 10, 4, 23, 30), walk_id="w_a_night")
        self.db.walks.update_one({"_id": "w_a_walk"}, {"$set": {"distance_m": 1234.4}})
        self.db.walks.update_one({"_id": "w_a_night"}, {"$set": {"distance_m": 100.0}})
        self.assertEqual(engine.stats(self.db, "w_a"), {
            "distance_m": 1334, "minutes": 30, "facades": 3, "streets": 2,
            "floors_scanned": 5, "streak_days": 2})

    def test_empty_walker(self):
        self.assertEqual(engine.stats(self.db, "w_nobody")["facades"], 0)
        self.assertEqual(engine.evaluate_walker(self.db, "w_nobody"), [])


class EvaluateTest(Base):
    def test_first_look_once(self):
        self.capture("a1")
        first = engine.evaluate_walker(self.db, "w_a")
        self.assertEqual(self.ids(first), ["first_look"])
        self.assertIsNone(first[0]["building_id"])
        self.assertEqual(engine.evaluate_walker(self.db, "w_a"), [])
        self.assertEqual(self.db.awards.count_documents({}), 1)

    def test_creates_unique_index(self):
        engine.evaluate_walker(self.db, "w_a")
        idx = self.db.awards.index_information()["walker_badge_building"]
        self.assertTrue(idx["unique"])
        self.assertEqual(idx["key"], [("walker_id", 1), ("badge_id", 1), ("building_id", 1)])

    def test_street_scout_and_main_street(self):
        for i in range(19):
            self.capture(f"abbey_{i}", at=T0 + timedelta(minutes=i))
        self.capture("talbot_1", street="Talbot Street", at=T0 + timedelta(minutes=30))
        self.assertEqual(self.ids(engine.evaluate_walker(self.db, "w_a")), ["first_look", "street_scout"])
        self.capture("abbey_19", at=T0 + timedelta(minutes=40))
        self.assertEqual(self.ids(engine.evaluate_walker(self.db, "w_a")), ["main_street"])

    def test_street_names_compare_loosely(self):
        for i in range(10):
            self.capture(f"x{i}", street="Middle Abbey St")
        for i in range(10):
            self.capture(f"y{i}", street="middle abbey street")
        self.assertIn("main_street", self.ids(engine.evaluate_walker(self.db, "w_a")))

    def test_no_street_from_photo_name(self):
        for i in range(20):
            self.capture(f"IMG_{8500 + i}", street=None)
        self.assertEqual(engine.stats(self.db, "w_a")["streets"], 0)
        self.assertNotIn("main_street", self.ids(engine.evaluate_walker(self.db, "w_a")))

    def test_same_building_counts_once(self):
        self.capture("a1")
        self.db.walks.update_one({"_id": "w_a_walk"}, {"$push": {"building_ids": "a1"}})
        self.assertEqual(engine.stats(self.db, "w_a")["facades"], 1)

    def test_five_k_is_cumulative(self):
        self.capture("a1", walk_id="w1")
        self.capture("a2", walk_id="w2", at=T0 + timedelta(hours=3))
        self.db.walks.update_one({"_id": "w1"}, {"$set": {"distance_m": 3000.0}})
        self.db.walks.update_one({"_id": "w2"}, {"$set": {"distance_m": 1999.0}})
        self.assertNotIn("five_k", self.ids(engine.evaluate_walker(self.db, "w_a")))
        self.db.walks.update_one({"_id": "w2"}, {"$set": {"distance_m": 2000.0}})
        self.assertEqual(self.ids(engine.evaluate_walker(self.db, "w_a")), ["five_k"])

    def test_streak_counts_distinct_days(self):
        self.capture("a1", at=T0)
        self.capture("a2", at=T0 + timedelta(hours=2))
        self.capture("a3", at=T0 + timedelta(days=2))
        self.assertNotIn("streak_3", self.ids(engine.evaluate_walker(self.db, "w_a")))
        self.capture("a4", at=T0 + timedelta(days=5))
        self.assertEqual(self.ids(engine.evaluate_walker(self.db, "w_a")), ["streak_3"])

    def test_local_knowledge(self):
        self.capture("a1", shop_staff_answer="   ")
        self.assertNotIn("local_knowledge", self.ids(engine.evaluate_walker(self.db, "w_a")))
        self.capture("a2", shop_staff_answer="Flat upstairs empty since 2019", at=T0 + timedelta(minutes=5))
        new = engine.evaluate_walker(self.db, "w_a")
        self.assertEqual(self.ids(new), ["local_knowledge"])
        self.assertEqual(new[0]["building_id"], "a2")

    def test_inspection_badges_not_from_evaluate(self):
        self.capture("a1", inspection={"outcome": "confirmed_candidate"})
        self.assertEqual(self.ids(engine.evaluate_walker(self.db, "w_a")), ["first_look"])


class SecondLookTest(Base):
    def setUp(self):
        super().setUp()
        self.capture("b1", walker="w_b", at=T0)

    def test_awarded(self):
        self.capture("a1", at=T0 + timedelta(hours=1), phash=flip_bits(PHASH, 8),
                     pos=offset(LON, LAT, 25))
        new = engine.evaluate_walker(self.db, "w_a")
        self.assertEqual(self.ids(new), ["first_look", "second_look"])
        self.assertEqual([a["building_id"] for a in new if a["badge_id"] == "second_look"], ["a1"])
        self.assertEqual(engine.evaluate_walker(self.db, "w_a"), [])

    def test_once_per_walker(self):
        self.capture("a1", at=T0 + timedelta(hours=1))
        engine.evaluate_walker(self.db, "w_a")
        self.capture("b2", walker="w_b", at=T0 + timedelta(hours=2), pos=offset(LON, LAT, 500))
        self.capture("a2", at=T0 + timedelta(hours=3), pos=offset(LON, LAT, 500))
        self.assertEqual(engine.evaluate_walker(self.db, "w_a"), [])

    def test_hamming_9_too_far(self):
        self.capture("a1", at=T0 + timedelta(hours=1), phash=flip_bits(PHASH, 9))
        self.assertNotIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_a")))

    def test_31_m_too_far(self):
        self.capture("a1", at=T0 + timedelta(hours=1), pos=offset(LON, LAT, 31))
        self.assertNotIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_a")))

    def test_other_must_be_earlier(self):
        self.capture("a1", at=T0 - timedelta(hours=1))
        self.assertNotIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_a")))
        # ... but then w_b re-captured w_a's facade.
        self.assertIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_b")))

    def test_own_earlier_capture_does_not_count(self):
        self.capture("a0", at=T0 - timedelta(hours=2))
        self.capture("a1", at=T0 - timedelta(hours=1))
        self.assertNotIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_a")))

    def test_falls_back_to_building_location(self):
        self.db.walks.update_many({}, {"$unset": {"captures": ""}})
        self.capture("a1", at=T0 + timedelta(hours=1), pos=offset(LON, LAT, 10))
        self.db.walks.update_many({}, {"$unset": {"captures": ""}})
        self.assertIn("second_look", self.ids(engine.evaluate_walker(self.db, "w_a")))


class InspectionTest(Base):
    def test_homes_above_and_lights_on(self):
        self.capture("a1")
        homes = engine.on_inspection(self.db, "a1", "confirmed_candidate")
        self.assertEqual([(a["walker_id"], a["badge_id"], a["building_id"]) for a in homes],
                         [("w_a", "homes_above", "a1")])
        self.assertEqual(engine.on_inspection(self.db, "a1", "confirmed_candidate"), [])
        self.assertEqual(self.ids(engine.on_inspection(self.db, "a1", "returned_to_use")), ["lights_on"])

    def test_per_building(self):
        self.capture("a1")
        self.capture("a2")
        engine.on_inspection(self.db, "a1", "confirmed_candidate")
        self.assertEqual(len(engine.on_inspection(self.db, "a2", "confirmed_candidate")), 1)

    def test_no_award(self):
        self.capture("a1")
        self.db.buildings.insert_one({"_id": "uncaptured"})
        self.assertEqual(engine.on_inspection(self.db, "a1", "not_suitable"), [])
        self.assertEqual(engine.on_inspection(self.db, "uncaptured", "confirmed_candidate"), [])
        self.assertEqual(engine.on_inspection(self.db, "missing", "confirmed_candidate"), [])

    def test_duplicate_key_from_index_is_ignored(self):
        """An award written with another _id (e.g. by hand) still blocks a duplicate via the index."""
        self.capture("a1")
        engine.evaluate_walker(self.db, "w_a")  # creates the index
        self.db.awards.insert_one({"_id": "manual", "walker_id": "w_a", "badge_id": "homes_above",
                                   "building_id": "a1", "at": T0, "reason": "manual"})
        self.assertEqual(engine.on_inspection(self.db, "a1", "confirmed_candidate"), [])


class RoutesTest(Base):
    def setUp(self):
        super().setUp()
        app = FastAPI()
        app.include_router(routes.router)
        self.client = TestClient(app)
        self.published = []
        patches = [mock.patch.object(routes, "get_db", return_value=self.db),
                   mock.patch.object(routes.events, "publish",
                                     side_effect=lambda t, p=None: self.published.append((t, p)))]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_badges_catalog(self):
        badges = self.client.get("/api/badges").json()
        self.assertEqual({b["id"] for b in badges}, {
            "first_look", "street_scout", "main_street", "five_k", "streak_3",
            "local_knowledge", "second_look", "homes_above", "lights_on"})
        for b in badges:
            self.assertLessEqual({"id", "title", "description", "tier", "icon", "target"}, set(b))
            self.assertIn(b["tier"], {"bronze", "silver", "gold", "civic"})
            self.assertNotIn("vacant", json.dumps(b).lower())

    def test_walker_profile(self):
        self.assertEqual(self.client.get("/api/walkers/w_ghost").status_code, 404)
        self.capture("a1")
        self.client.post("/api/walkers/w_a/evaluate")
        d = self.client.get("/api/walkers/w_a").json()
        self.assertEqual(d["walker"], {"_id": "w_a", "id": "w_a", "name": "A", "town": "Dublin"})
        self.assertEqual(d["stats"]["facades"], 1)
        self.assertEqual([a["badge_id"] for a in d["awards"]], ["first_look"])
        self.assertEqual(d["awards"][0]["title"], "First Look")
        self.assertEqual(d["awards"][0]["id"], "w_a:first_look:-")
        self.assertEqual(datetime.fromisoformat(d["awards"][0]["at"]).utcoffset(), timedelta(0))
        prog = {p["badge_id"]: p for p in d["progress"]}
        self.assertEqual(len(prog), 9)
        self.assertEqual(prog["street_scout"], {"badge_id": "street_scout", "current": 1, "target": 10})

    def test_walks_privacy(self):
        self.capture("a1", upper_status="likely_underused", upper_signals=["shutters"],
                     needs_human=True, verifier={"agree": True}, display_status="review",
                     label="Middle Abbey St 24", evidence="...")
        self.capture("a2", at=T0 + timedelta(minutes=5), pos=offset(LON, LAT, 20))
        # a2 was later re-imported by w_b: it is no longer w_a's capture.
        self.db.buildings.update_one({"_id": "a2"}, {"$set": {"captured_by": "w_b"}})
        r = self.client.get("/api/walkers/w_a/walks")
        self.assertEqual(r.status_code, 200)
        for word in ("upper_status", "upper_signals", "display_status", "needs_human", "verifier",
                     "likely_underused", "evidence", "Middle Abbey St 24"):
            self.assertNotIn(word, r.text)
        (walk,) = r.json()
        self.assertEqual(walk["id"], "w_a_walk")
        (cap,) = walk["captures"]
        self.assertEqual(set(cap), {"building_id", "lon", "lat", "t", "thumb"})
        self.assertEqual((cap["building_id"], cap["lon"], cap["lat"], cap["thumb"]),
                         ("a1", LON, LAT, "/photos/a1.jpg"))
        self.assertEqual(cap["t"], "2026-10-04T10:00:00+00:00")

    def test_evaluate_publishes_each_new_award(self):
        for i in range(10):
            self.capture(f"a{i}")
        r = self.client.post("/api/walkers/w_a/evaluate").json()
        self.assertEqual(sorted(a["badge_id"] for a in r["awards"]), ["first_look", "street_scout"])
        self.assertEqual([t for t, _ in self.published], ["badge.awarded"] * 2)
        self.assertEqual(self.published[0][1], {"walker_id": "w_a", "badge_id": "first_look",
                                                "building_id": None, "title": "First Look"})
        self.assertEqual(self.client.post("/api/walkers/w_a/evaluate").json(), {"awards": []})
        self.assertEqual(len(self.published), 2)


if __name__ == "__main__":
    unittest.main()
