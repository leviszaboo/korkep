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
  changedArticleIds: number[];
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
  const storyIdsThatLoseArticles = new Set<number>();

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
    const storyId = best?.storyId ?? null;
    const changedArticleIds = storyId == null
      ? []
      : articleIds.filter((articleId) => input.currentAssignments.get(articleId) !== storyId);

    for (const articleId of changedArticleIds) {
      const previousStoryId = input.currentAssignments.get(articleId);
      if (previousStoryId != null && previousStoryId !== storyId) {
        storyIdsThatLoseArticles.add(previousStoryId);
      }
    }

    storyMatches.push({
      clusterKey: cluster.clusterKey,
      storyId,
      articleIds,
      changedArticleIds,
    });
  }

  const finalAssignedArticleIds = new Set(storyMatches.flatMap((match) => match.articleIds));

  for (const existing of input.existingStories) {
    const retained = storyMatches.find((match) => match.storyId === existing.storyId);
    if (!retained) continue;

    for (const articleId of existing.articleIds) {
      if (!finalAssignedArticleIds.has(articleId)) {
        storyIdsThatLoseArticles.add(existing.storyId);
      }
    }
  }

  const articleAssignments: ArticleAssignmentChange[] = [];
  for (const match of storyMatches) {
    if (match.storyId == null) continue;
    for (const articleId of match.changedArticleIds) {
      articleAssignments.push({ articleId, storyId: match.storyId });
    }
  }

  const storyIdsToCheckForDeletion = [...storyIdsThatLoseArticles].sort((a, b) => a - b);

  return { storyMatches, articleAssignments, storyIdsToCheckForDeletion };
}
