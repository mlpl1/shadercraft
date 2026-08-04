/**
 * How long a queued transaction waits for the connection to free up before giving up.
 *
 * Every transaction in this app is a handful of statements and completes in milliseconds, so a wait
 * this long means the connection is not going to free up — in practice, that a transaction was
 * opened from inside another one. See {@link TransactionQueue} for why that cannot be detected
 * directly.
 */
export const TRANSACTION_QUEUE_TIMEOUT_MS = 15_000;

/**
 * Serializes transaction bodies so at most one is ever open on a connection.
 *
 * Neither SQLite driver supports nested transactions: `BEGIN` inside an open transaction fails, and
 * `withTransactionAsync` has no nesting support either. Before this queue, safety depended on call
 * ordering across several unrelated files — nothing stopped two independent callers opening a
 * transaction at once, and the second would fail. Chaining every body through one promise makes the
 * ordering structural instead.
 *
 * A caveat worth knowing: a transaction opened *from inside* another transaction on the same
 * connection can never get its turn, because its own outer transaction is what it is waiting for.
 * JavaScript gives no way to tell that apart from an unrelated concurrent caller, which is a
 * legitimate wait. So rather than hang forever, a queued body that waits past
 * {@link TRANSACTION_QUEUE_TIMEOUT_MS} rejects with an explanation. Nesting used to fail fast with a
 * SQLite error; this keeps it a diagnosable failure rather than a silent stall.
 */
export class TransactionQueue {
  /** Resolves when the currently queued work is finished. Never rejects. */
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>, timeoutMs: number = TRANSACTION_QUEUE_TIMEOUT_MS): Promise<T> {
    const previous = this.tail;

    const result = (async () => {
      await waitForTurn(previous, timeoutMs);
      return work();
    })();

    // The next caller waits for the predecessor *and* this call, not just this call. Giving up on the
    // wait above does not close the transaction that is holding the connection: `result` rejects while
    // the predecessor's body is very much still running, so a tail chained on `result` alone would
    // release the queue early and let the next body open a second transaction alongside the first —
    // abandoning serialization at exactly the moment something has already gone wrong. Both are
    // settled rather than raced, and their outcomes are swallowed so one failed transaction never
    // rejects the next caller's wait.
    this.tail = Promise.allSettled([previous, result]);

    return result;
  }
}

async function waitForTurn(previous: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      previous,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Waited ${timeoutMs}ms for an open transaction to finish. A transaction cannot be ` +
                  `opened from inside another transaction on the same connection.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
