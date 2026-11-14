import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.routes import router
from app.core.config import BASE_DIR, get_settings
from app.core.logging import configure_logging
from app.services.audit import init_db

settings = get_settings()
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
# Changes on every server start so browsers fetch fresh CSS/JS after a deploy
ASSET_VERSION = str(int(time.time()))


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    init_db()  # create the audit table before the first /api/chat call
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.include_router(router)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        request, "index.html", {"app_name": settings.app_name, "v": ASSET_VERSION}
    )
