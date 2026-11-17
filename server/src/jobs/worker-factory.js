import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { deadLetterName } from './queues.js';

export { UnrecoverableError };

/**
 * Creates a worker whose processor is looked up by job name. When a job fails
 * for the last time (attempts exhausted, or an UnrecoverableError was thrown)
 * it is copied to `<queue>-dead-letter` for manual inspection and replay.
 */
export function createWorker(queueName, processors, { connection, prefix, logger, concurrency = 5 }) {
  const dlq = new Queue(deadLetterName(queueName), { connection, prefix });

  const worker = new Worker(
    queueName,
    async (job) => {
      const handler = processors[job.name];
      if (!handler) throw new UnrecoverableError(`No processor registered for job "${job.name}"`);
      return handler(job, { logger: logger.child({ queue: queueName, job: job.name, jobId: job.id }) });
    },
    { connection, prefix, concurrency },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts || err instanceof UnrecoverableError || err?.name === 'UnrecoverableError';
    logger.warn(
      { queue: queueName, job: job.name, jobId: job.id, attemptsMade: job.attemptsMade, exhausted, err: err.message },
      'job failed',
    );
    if (exhausted) {
      await dlq.add(
        job.name,
        { originalJobId: job.id, originalQueue: queueName, data: job.data, failedReason: err.message, failedAt: new Date().toISOString() },
        { jobId: `dlq__${job.id}`, removeOnComplete: false, removeOnFail: false },
      );
    }
  });

  worker.on('error', (err) => logger.error({ queue: queueName, err }, 'worker error'));

  const close = async () => {
    await worker.close();
    await dlq.close();
  };

  return { worker, dlq, close };
}
