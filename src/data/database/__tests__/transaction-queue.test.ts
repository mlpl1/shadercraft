import { NodeSqliteDriver } from "../testing/node-sqlite-driver";
import { TransactionQueue } from "../transaction-queue";

describe("TransactionQueue", () => {
  it("runs queued work one body at a time, in call order", async () => {
    const queue = new TransactionQueue();
    const events: string[] = [];

    const first = queue.run(async () => {
      events.push("first:start");
      await Promise.resolve();
      await Promise.resolve();
      events.push("first:end");
      return "a";
    });
    const second = queue.run(async () => {
      events.push("second:start");
      events.push("second:end");
      return "b";
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);

    // No interleaving: the second body must not start before the first finishes.
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("lets the next body run after the previous one throws", async () => {
    const queue = new TransactionQueue();

    const failing = queue.run(async () => {
      throw new Error("boom");
    });
    const following = queue.run(async () => "recovered");

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("recovered");
  });

  it("rejects with an explanation instead of hanging when work is opened from inside work", async () => {
    const queue = new TransactionQueue();

    // The inner call can never get its turn: the outer body it is waiting on is its own caller.
    await expect(
      queue.run(async () => queue.run(async () => "inner", 40), 40),
    ).rejects.toThrow(/cannot be opened from inside another transaction/i);
  });
});

describe("NodeSqliteDriver transactions", () => {
  let driver: NodeSqliteDriver;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await driver.exec("CREATE TABLE counter (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  });

  afterEach(async () => {
    await driver.close();
  });

  it("serializes transactions opened concurrently rather than failing on a nested BEGIN", async () => {
    // Before the queue this rejected: the second `BEGIN` lands while the first transaction is still
    // open, which SQLite refuses. This is the exact shape the sync engine will produce once upload
    // batches race progress writes from the UI.
    await Promise.all([
      driver.transaction(async () => {
        await driver.run("INSERT INTO counter (label) VALUES (?)", ["first"]);
      }),
      driver.transaction(async () => {
        await driver.run("INSERT INTO counter (label) VALUES (?)", ["second"]);
      }),
      driver.transaction(async () => {
        await driver.run("INSERT INTO counter (label) VALUES (?)", ["third"]);
      }),
    ]);

    const rows = await driver.all<{ label: string }>("SELECT label FROM counter ORDER BY id");
    expect(rows.map((row) => row.label)).toEqual(["first", "second", "third"]);
  });

  it("rolls back a failed transaction without blocking the next one", async () => {
    await expect(
      driver.transaction(async () => {
        await driver.run("INSERT INTO counter (label) VALUES (?)", ["doomed"]);
        throw new Error("rollback please");
      }),
    ).rejects.toThrow("rollback please");

    await driver.transaction(async () => {
      await driver.run("INSERT INTO counter (label) VALUES (?)", ["survivor"]);
    });

    const rows = await driver.all<{ label: string }>("SELECT label FROM counter ORDER BY id");
    expect(rows.map((row) => row.label)).toEqual(["survivor"]);
  });
});
