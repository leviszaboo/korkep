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
log = logging.getLogger("batch-clusterer")

app = FastAPI(title="Körkép Batch Clusterer")


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
    start = time.perf_counter()
    n_items = len(req.items)
    log.info("Recluster started: %d items, min_cluster_size=%d", n_items, req.min_cluster_size)

    ids = [item.id for item in req.items]
    embeddings = [item.embedding for item in req.items]
    timestamps = None
    if all(item.timestamp_hours is not None for item in req.items):
        timestamps = [item.timestamp_hours for item in req.items]

    labels = recluster(embeddings, min_cluster_size=req.min_cluster_size, timestamps_hours=timestamps)

    num_clusters = len(set(l for l in labels if l >= 0))
    noise_count = sum(1 for l in labels if l < 0)
    cluster_sizes = {}
    for l in labels:
        if l >= 0:
            cluster_sizes[l] = cluster_sizes.get(l, 0) + 1
    avg_cluster_size = sum(cluster_sizes.values()) / max(len(cluster_sizes), 1)
    largest_cluster = max(cluster_sizes.values()) if cluster_sizes else 0

    duration_ms = round((time.perf_counter() - start) * 1000)
    log.info(
        "Recluster complete: %d clusters, %d noise, avg_size=%.1f, largest=%d, %dms",
        num_clusters, noise_count, avg_cluster_size, largest_cluster, duration_ms,
    )

    results = [ReclusterResultItem(id=id, cluster=label) for id, label in zip(ids, labels)]
    return ReclusterResponse(results=results, num_clusters=num_clusters)


@app.get("/health")
def health():
    return {"status": "ok"}
