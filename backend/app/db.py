"""MongoDB access. One shared client per process."""
import os
from functools import lru_cache

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.database import Database

load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> MongoClient:
    return MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=8000)


def get_db() -> Database:
    return get_client()[os.environ.get("MONGODB_DB", "homesabove")]
