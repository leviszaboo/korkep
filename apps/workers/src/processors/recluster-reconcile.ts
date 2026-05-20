export interface ExistingStoryArticles {
  storyId: number;
  articleIds: number[];
}

export interface FinalClusterArticles {
  clusterKey: string;
  articleIds: number[];
}

export interface StoryMatch {
  clusterKey: string;
  storyId: number | null;
  articleIds: number[];
}

export interface ArticleAssignmentChange {
  articleId: number;
  storyId: number;
}

export interface StoryReconciliationPlan {
  storyMatches: StoryMatch[];
  articleAssignments: ArticleAssignmentChange[];
  storyIdsToCheckForDeletion: number[];
}

interface Candidate {
  storyId: number;
  overlap: number;
  ratio: number;
}

function uniqueSorted(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function compareCandidate(a: Candidate, b: Candidate): number {
  if (a.overlap !== b.overlap) return b.overlap - a.overlap;
  if (a.ratio !== b.ratio) return b.ratio - a.ratio;
  return a.storyId - b.storyId;
}

export function planStoryReconciliation(input: {
  existingStories: ExistingStoryArticles[];
  finalClusters: FinalClusterArticles[];
  currentAssignments: Map<number, number | null>;
}): StoryReconciliationPlan {
  const existingByStory = new Map<number, Set<number>>();
  for (const story of input.existingStories) {
    existingByStory.set(story.storyId, new Set(story.articleIds));
  }

  const usedStoryIds = new Set<number>();
  const storyMatches: StoryMatch[] = [];

  for (const cluster of input.finalClusters) {
    const articleIds = uniqueSorted(cluster.articleIds);
    const candidates = new Map<number, Candidate>();

    for (const articleId of articleIds) {
      const storyId = input.currentAssignments.get(articleId);
      if (storyId == null || usedStoryIds.has(storyId)) continue;

      const existingArticles = existingByStory.get(storyId);
      if (!existingArticles) continue;

      const current = candidates.get(storyId) ?? {
        storyId,
        overlap: 0,
        ratio: 0,
      };
      current.overlap += 1;
      current.ratio = current.overlap / existingArticles.size;
      candidates.set(storyId, current);
    }

    const best = [...candidates.values()].sort(compareCandidate)[0];
    if (best) usedStoryIds.add(best.storyId);

    storyMatches.push({
      clusterKey: cluster.clusterKey,
      storyId: best?.storyId ?? null,
      articleIds,
    });
  }

  const articleAssignments: ArticleAssignmentChange[] = [];
  for (const match of storyMatches) {
    if (match.storyId == null) continue;
    for (const articleId of match.articleIds) {
      if (input.currentAssignments.get(articleId) !== match.storyId) {
        articleAssignments.push({ articleId, storyId: match.storyId });
      }
    }
  }

  const assignedExistingStoryIds = new Set<number>();
  for (const match of storyMatches) {
    if (match.storyId != null) assignedExistingStoryIds.add(match.storyId);
  }

  const storyIdsToCheckForDeletion = input.existingStories
    .map((story) => story.storyId)
    .filter((storyId) => !assignedExistingStoryIds.has(storyId))
    .sort((a, b) => a - b);

  return { storyMatches, articleAssignments, storyIdsToCheckForDeletion };
}
