import logging

import numpy as np
from sklearn.cluster import HDBSCAN
from sklearn.metrics.pairwise import cosine_distances
from umap import UMAP

log = logging.getLogger("batch-clusterer")

MAX_CLUSTER_SIZE = 24
TIME_WEIGHT = 0.55
TIME_SCALE_HOURS = 12.0

UMAP_COMPONENTS = 22
UMAP_NEIGHBORS = 15
UMAP_MIN_ARTICLES = 43


def _time_distance_matrix(timestamps: np.ndarray) -> np.ndarray:
    diff = np.abs(timestamps[:, None] - timestamps[None, :])
    return diff / TIME_SCALE_HOURS


def _composite_distance_matrix(
    embeddings: np.ndarray, timestamps: np.ndarray
) -> np.ndarray:
    cos_dist = cosine_distances(embeddings)
    time_dist = _time_distance_matrix(timestamps)
    time_dist = np.clip(time_dist, 0, 1)
    return (1 - TIME_WEIGHT) * cos_dist + TIME_WEIGHT * time_dist


def _reduce_with_umap(embeddings: np.ndarray) -> np.ndarray:
    n_samples = embeddings.shape[0]
    n_components = min(UMAP_COMPONENTS, n_samples - 2)
    n_neighbors = min(UMAP_NEIGHBORS, n_samples - 1)

    reducer = UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        metric="cosine",
        min_dist=0.0,
        random_state=42,
    )
    reduced = reducer.fit_transform(embeddings)
    log.info("UMAP: %d dims -> %d dims (%d samples)", embeddings.shape[1], n_components, n_samples)
    return reduced


def _split_large_clusters(
    labels: np.ndarray,
    embeddings: np.ndarray,
    timestamps: np.ndarray | None,
    max_size: int,
    _depth: int = 0,
) -> np.ndarray:
    MAX_SPLIT_DEPTH = 4
    result = labels.copy()
    next_label = max(labels.max() + 1, 0)
    needs_resplit = False

    for cluster_id in set(l for l in labels if l >= 0):
        mask = labels == cluster_id
        indices = np.where(mask)[0]
        if len(indices) <= max_size:
            continue

        sub_embeddings = embeddings[indices]
        if timestamps is not None:
            sub_timestamps = timestamps[indices]
            sub_dist = _composite_distance_matrix(sub_embeddings, sub_timestamps)
        else:
            sub_dist = cosine_distances(sub_embeddings)

        np.fill_diagonal(sub_dist, 0)
        sub_dist = np.maximum(sub_dist, 0)

        sub_clusterer = HDBSCAN(
            min_cluster_size=2,
            min_samples=1,
            metric="precomputed",
            cluster_selection_epsilon=0.10,
        )
        sub_labels = sub_clusterer.fit_predict(sub_dist)

        for sub_id in set(sub_labels):
            sub_mask = sub_labels == sub_id
            count = int(sub_mask.sum())
            if sub_id < 0:
                for idx in indices[sub_mask]:
                    result[idx] = -1
            else:
                for idx in indices[sub_mask]:
                    result[idx] = next_label
                if count > max_size:
                    needs_resplit = True
                next_label += 1

    if needs_resplit and _depth < MAX_SPLIT_DEPTH:
        result = _split_large_clusters(result, embeddings, timestamps, max_size, _depth + 1)

    # Hard cap: any cluster still over max_size gets forcibly chunked
    for cluster_id in set(l for l in result if l >= 0):
        mask = result == cluster_id
        indices = np.where(mask)[0]
        if len(indices) <= max_size:
            continue
        log.warning("Force-chunking cluster %d with %d items (max %d)", cluster_id, len(indices), max_size)
        for i in range(0, len(indices), max_size):
            chunk = indices[i : i + max_size]
            for idx in chunk:
                result[idx] = next_label
            next_label += 1

    return result


def recluster(
    embeddings: list[list[float]],
    min_cluster_size: int = 2,
    timestamps_hours: list[float] | None = None,
) -> list[int]:
    import time as _time
    t0 = _time.perf_counter()

    matrix = np.array(embeddings)
    n = len(embeddings)
    dims = matrix.shape[1] if matrix.ndim == 2 else 0
    log.info("Input: %d items, %d dimensions", n, dims)

    ts = None
    if timestamps_hours is not None and len(timestamps_hours) == n:
        ts = np.array(timestamps_hours)
        log.info("Time weighting enabled (weight=%.2f, scale=%.1fh)", TIME_WEIGHT, TIME_SCALE_HOURS)

    use_umap = n >= UMAP_MIN_ARTICLES

    if use_umap:
        reduced = _reduce_with_umap(matrix)

        if ts is not None:
            time_dist = _time_distance_matrix(ts)
            time_dist = np.clip(time_dist, 0, 1)

            from sklearn.metrics.pairwise import euclidean_distances
            eucl_dist = euclidean_distances(reduced)
            eucl_max = eucl_dist.max()
            if eucl_max > 0:
                eucl_dist /= eucl_max

            dist_matrix = (1 - TIME_WEIGHT) * eucl_dist + TIME_WEIGHT * time_dist
        else:
            from sklearn.metrics.pairwise import euclidean_distances
            dist_matrix = euclidean_distances(reduced)
            eucl_max = dist_matrix.max()
            if eucl_max > 0:
                dist_matrix /= eucl_max

        np.fill_diagonal(dist_matrix, 0)
        dist_matrix = np.maximum(dist_matrix, 0)

        clusterer = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=3,
            metric="precomputed",
            cluster_selection_epsilon=0.0,
        )
        labels = clusterer.fit_predict(dist_matrix)
    else:
        if ts is not None:
            dist_matrix = _composite_distance_matrix(matrix, ts)
        else:
            dist_matrix = cosine_distances(matrix)

        np.fill_diagonal(dist_matrix, 0)
        dist_matrix = np.maximum(dist_matrix, 0)

        clusterer = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=3,
            metric="precomputed",
            cluster_selection_epsilon=0.0,
        )
        labels = clusterer.fit_predict(dist_matrix)

    pre_split_clusters = len(set(l for l in labels if l >= 0))
    labels = _split_large_clusters(labels, matrix, ts, MAX_CLUSTER_SIZE)
    post_split_clusters = len(set(l for l in labels if l >= 0))

    duration_ms = round((_time.perf_counter() - t0) * 1000)
    if post_split_clusters != pre_split_clusters:
        log.info("Split large clusters: %d -> %d clusters", pre_split_clusters, post_split_clusters)
    log.info("Clustering pipeline: %dms total", duration_ms)

    return labels.tolist()
