"""Voting Tracker data pipeline.

Downloads official congressional data, stores it in SQLite (data/tracker.db) and exports the
JSON files the website reads (web/data/). Run it with:  python -m pipeline update
"""
