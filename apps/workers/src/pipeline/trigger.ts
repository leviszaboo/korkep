import { config } from '../config.js';
import { logger } from '../logger.js';

export async function triggerNextJob(articleCount: number): Promise<void> {
  const { nextJob, autoChain, triggerMode } = config.pipeline;

  if (articleCount === 0) {
    logger.info('No articles to process, skipping next job trigger');
    return;
  }

  if (autoChain) {
    logger.info({ nextJob: nextJob || 'inline' }, 'AUTO_CHAIN: running next stage inline');
    await runInline(nextJob);
    return;
  }

  if (!nextJob) {
    logger.info('No NEXT_JOB configured, pipeline stops here');
    return;
  }

  if (process.env.CLOUD_RUN_JOB) {
    await triggerCloudRunJob(nextJob, triggerMode);
  } else {
    logger.info({ nextJob }, 'Not in Cloud Run, skipping trigger (run manually or set AUTO_CHAIN=true)');
  }
}

async function runInline(nextJob: string): Promise<void> {
  switch (nextJob) {
    case 'process': {
      const { main: processMain } = await import('./process-job.js');
      await processMain();
      break;
    }
    case 'embed-cluster': {
      const { main: embedMain } = await import('./embed-cluster-job.js');
      await embedMain();
      break;
    }
    default:
      logger.warn({ nextJob }, 'Unknown next job for inline execution');
  }
}

async function triggerCloudRunJob(
  jobName: string,
  triggerMode: 'scheduled' | 'manual',
): Promise<void> {
  const { gcpProjectId, gcpRegion } = config.pipeline;

  const metadataUrl =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

  let accessToken: string;
  try {
    const tokenRes = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!tokenRes.ok) {
      throw new Error(`Token fetch failed: ${tokenRes.status}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };
    accessToken = tokenData.access_token;
  } catch (err) {
    logger.error({ err, jobName }, 'Failed to get GCP access token, cannot trigger next job');
    return;
  }

  const url = `https://${gcpRegion}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${gcpProjectId}/jobs/${jobName}:run`;

  const body = {
    overrides: {
      containerOverrides: [
        {
          env: [{ name: 'TRIGGER_MODE', value: triggerMode }],
        },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ jobName, status: res.status, body: text }, 'Failed to trigger Cloud Run Job');
    } else {
      logger.info({ jobName, triggerMode }, 'Triggered Cloud Run Job');
    }
  } catch (err) {
    logger.error({ err, jobName }, 'Error triggering Cloud Run Job');
  }
}
