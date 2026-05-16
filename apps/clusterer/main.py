import logging
import time

from fastapi import FastAPI, Request
from pydantic import BaseModel

from cluster import recluster

logging.basicConfig(
    level=logging.INFO,
    format="\033[36m%(asctime)s\033[0m \033[32m%(levelname)-5s\033[0m %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("clusterer")

app = FastAPI(title="Ground News Clusterer")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = round((time.perf_counter() - start) * 1000)
    log.info("%s %s %s %dms", request.method, request.url.path, response.status_code, ms)
    return response


class ReclusterItem(BaseModel):
    id: int
    embedding: list[float]
    timestamp_hours: float | None = None


class ReclusterRequest(BaseModel):
    items: list[ReclusterItem]
    min_cluster_size: int = 2


class ReclusterResultItem(BaseModel):
    id: int
    cluster: int


class ReclusterResponse(BaseModel):
    results: list[ReclusterResultItem]
    num_clusters: int


@app.post("/recluster", response_model=ReclusterResponse)
def recluster_endpoint(req: ReclusterRequest):
    ids = [item.id for item in req.items]
    embeddings = [item.embedding for item in req.items]
    timestamps = None
    if all(item.timestamp_hours is not None for item in req.items):
        timestamps = [item.timestamp_hours for item in req.items]
    labels = recluster(embeddings, min_cluster_size=req.min_cluster_size, timestamps_hours=timestamps)
    num_clusters = len(set(l for l in labels if l >= 0))
    results = [ReclusterResultItem(id=id, cluster=label) for id, label in zip(ids, labels)]
    return ReclusterResponse(results=results, num_clusters=num_clusters)


@app.get("/health")
def health():
    return {"status": "ok"}
