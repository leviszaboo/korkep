export interface MergeCandidate {
  articleIds: number[];
  centroid: number[];
}

interface MergeGroup {
  indices: number[];
  articleCount: number;
  centroid: number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

export function averageVectors(vectors: number[][]): number[] {
  const valid = vectors.filter((v) => v.length > 0);
  if (valid.length === 0) return [];

  const dim = valid[0].length;
  const centroid = new Array(dim).fill(0);
  let count = 0;

  for (const vector of valid) {
    if (vector.length !== dim) continue;
    for (let i = 0; i < dim; i++) centroid[i] += vector[i];
    count++;
  }

  if (count === 0) return [];
  for (let i = 0; i < dim; i++) centroid[i] /= count;
  return centroid;
}

function mergeCentroids(
  a: number[],
  aWeight: number,
  b: number[],
  bWeight: number,
): number[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  if (a.length !== b.length) return [];

  const total = aWeight + bWeight;
  if (total <= 0) return [];

  return a.map((value, i) => ((value * aWeight) + (b[i] * bWeight)) / total);
}

export function buildRecursiveMergeGroups(
  stories: MergeCandidate[],
  threshold: number,
  maxMergedArticles: number,
): number[][] {
  const groups: MergeGroup[] = stories.map((story, index) => ({
    indices: [index],
    articleCount: story.articleIds.length,
    centroid: story.centroid,
  }));

  while (true) {
    let best: { i: number; j: number; similarity: number } | null = null;

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const articleCount = groups[i].articleCount + groups[j].articleCount;
        if (articleCount > maxMergedArticles) continue;

        const similarity = cosineSimilarity(groups[i].centroid, groups[j].centroid);
        if (similarity < threshold) continue;
        if (!best || similarity > best.similarity) {
          best = { i, j, similarity };
        }
      }
    }

    if (!best) break;

    const left = groups[best.i];
    const right = groups[best.j];
    const merged: MergeGroup = {
      indices: [...left.indices, ...right.indices],
      articleCount: left.articleCount + right.articleCount,
      centroid: mergeCentroids(left.centroid, left.articleCount, right.centroid, right.articleCount),
    };

    groups.splice(best.j, 1);
    groups.splice(best.i, 1, merged);
  }

  return groups.map((group) => group.indices);
}
