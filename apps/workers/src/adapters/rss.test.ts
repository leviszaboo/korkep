import { strict as assert } from 'node:assert';
import test from 'node:test';
import type Parser from 'rss-parser';
import { limitRssItems, rssItemToCandidate } from './rss.js';

test('limitRssItems caps work before article extraction', () => {
  const items = [{ title: 'one' }, { title: 'two' }, { title: 'three' }];

  assert.deepEqual(limitRssItems(items, 2), [{ title: 'one' }, { title: 'two' }]);
});

test('limitRssItems leaves items unchanged when no positive limit is provided', () => {
  const items = [{ title: 'one' }, { title: 'two' }];

  assert.deepEqual(limitRssItems(items, undefined), items);
  assert.deepEqual(limitRssItems(items, 0), items);
});

test('rssItemToCandidate maps RSS metadata without requiring HTML', () => {
  const item: Parser.Item = {
    link: 'https://example.com/article',
    title: 'RSS title',
    contentSnippet: 'RSS summary',
    isoDate: '2026-05-19T12:00:00.000Z',
    creator: 'Reporter',
    categories: ['Politics'],
    enclosure: {
      url: 'https://example.com/image.jpg',
      type: 'image/jpeg',
    },
  };

  assert.deepEqual(rssItemToCandidate(item, 'example'), {
    url: 'https://example.com/article',
    title: 'RSS title',
    bodyFallback: 'RSS summary',
    category: 'Politics',
    author: 'Reporter',
    imageUrl: 'https://example.com/image.jpg',
    publishedAt: new Date('2026-05-19T12:00:00.000Z'),
    sourceSlug: 'example',
  });
});
