"""Vercel entrypoint for the BreachLoop FastAPI service."""

from breachloop.api.app import create_app

app = create_app()

__all__ = ["app"]
