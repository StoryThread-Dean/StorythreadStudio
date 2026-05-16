# Storythread Studio Backend -- Main Entry Point
# ========================================
# This is where the backend server starts. When you run the server,
# Python loads this file, builds the FastAPI app, and begins listening
# for requests from the frontend.
#
# Analogy: Think of FastAPI like a restaurant. The "menu" is the list
# of routes (URLs) the frontend can call. FastAPI is the waiter who
# takes the order, passes it to the kitchen (your Python functions),
# and brings back the result. The kitchen never talks to the customer
# directly -- everything goes through the waiter.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import routers -- each router handles one area of the API.
# As we build more features, we'll add more routers here.
from app.routers import projects, documents, profiles, settings, ai, series, export, progress, search


# --- Create the FastAPI App ---
# This one line creates the entire application object.
# We pass it a title, description, and version -- these show up
# automatically in the interactive API docs at http://localhost:8000/docs
app = FastAPI(
    title="Storythread Studio API",
    description="Local backend server for the Storythread Studio writing app.",
    version="0.1.0",
)


# --- CORS Middleware ---
# CORS = "Cross-Origin Resource Sharing"
#
# When the React frontend (running on port 1420 via Tauri/Vite) sends
# a request to this Python server (running on port 8000), the browser
# treats them as different "origins" and blocks the request by default.
# It's like a security guard who won't let guests from one building
# walk into another without being on the approved list.
#
# This middleware puts the frontend on the approved list.
# Without it, every API call from React would be silently blocked.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",     # Vite dev server (React during development)
        "http://127.0.0.1:1420",    # Same address, different notation
        "tauri://localhost",         # Tauri v1 production origin (macOS/Linux)
        "http://tauri.localhost",    # Tauri v2 production origin (Windows WebView2)
        "https://tauri.localhost",   # Tauri v2 alternate (some platforms/configs)
    ],
    allow_credentials=True,    # Allows cookies and auth headers if needed later
    allow_methods=["*"],       # Accepts GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],       # Accepts any HTTP headers the frontend sends
)


# --- Root Route ---
# When you visit http://localhost:8000/ in a browser, this runs.
# It's a quick sanity check -- if you see this message, the server is alive.
#
# The @app.get("/") line is a "decorator". It tells FastAPI:
# "When a GET request arrives at the path '/', run the function below
# and send back whatever it returns as a JSON response."
@app.get("/")
async def root():
    """Friendly welcome message shown at the root URL."""
    return {
        "message": "Storythread Studio backend is running.",
        "tip": "Visit http://localhost:8000/docs for the interactive API explorer.",
    }


# --- Health Check Route ---
# A health check is a standard pattern: a simple route that returns "I'm alive."
# It's used to verify the server started correctly and is reachable.
# Later, the frontend can call this on startup to confirm the backend is up
# before trying to load any project data.
@app.get("/health")
async def health_check():
    """Returns a simple OK status. Use this to confirm the server is running."""
    return {
        "status": "ok",
        "app": "Storythread Studio API",
        "version": "0.1.0",
    }


# --- Include Routers ---
# Each router is registered here with app.include_router().
# The prefix in each router file (e.g., "/api/projects") becomes part of
# every route URL in that router automatically.
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(profiles.router)
app.include_router(settings.router)
app.include_router(ai.router)
app.include_router(series.router)
app.include_router(export.router)
app.include_router(progress.router)
app.include_router(search.router)


# --- What Comes Next ---
# As we build out phases 1-6, we will add more routes here (or in separate
# router files that we "include" into this app). For example:
#
#   from app.routers import projects, documents, profiles, ai
#   app.include_router(profiles.router)
#   app.include_router(ai.router)
#
# Each router file will handle one area of the app (projects, chapters, etc.)
# and keeps this main.py clean and readable.
