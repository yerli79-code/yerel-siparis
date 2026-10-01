import assert from "node:assert/strict";
import { test } from "node:test";
import { createNewOrderCountRequest } from "./new-order-count";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("older count cannot overwrite a newer response, even if abort is ignored", async () => {
  const request = createNewOrderCountRequest();
  const old = deferred<number>();
  const commits: number[] = [];
  let oldSignal!: AbortSignal;
  const pending = request.refresh(signal => { oldSignal = signal; return old.promise; }, n => commits.push(n));
  await request.refresh(async () => 4, n => commits.push(n));
  assert.equal(oldSignal.aborted, true);
  old.resolve(3);
  await pending;
  assert.deepEqual(commits, [4]);
});

test("mutation/unmount invalidation prevents a late commit", async () => {
  const request = createNewOrderCountRequest();
  const late = deferred<number>();
  const commits: number[] = [];
  const pending = request.refresh(() => late.promise, n => commits.push(n));
  request.invalidate();
  late.resolve(3);
  await pending;
  assert.equal(commits.length, 0);
  await request.refresh(async () => 2, n => commits.push(n));
  assert.deepEqual(commits, [2]);
});

test("superseded failure is ignored; current failure preserves the confirmed count", async () => {
  const request = createNewOrderCountRequest();
  const old = deferred<number>();
  const commits: number[] = [];
  const pending = request.refresh(() => old.promise, n => commits.push(n));
  await request.refresh(async () => 4, n => commits.push(n));
  old.reject(new Error("late failure"));
  await pending;
  await assert.rejects(request.refresh(async () => { throw new Error("offline"); }, n => commits.push(n)), /offline/);
  assert.deepEqual(commits, [4]);
});

test("zero and global totals greater than the overview limit are retained", async () => {
  const request = createNewOrderCountRequest();
  const commits: number[] = [];
  for (const total of [24, 0, null, -1, 1.5, Number.NaN]) {
    await request.refresh(async () => total, n => commits.push(n));
  }
  assert.deepEqual(commits, [24, 0]);
});
