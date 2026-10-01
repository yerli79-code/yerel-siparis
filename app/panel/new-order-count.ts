// One authoritative count request at a time; superseded work cannot commit.
export function createNewOrderCountRequest() {
  let generation = 0;
  let controller: AbortController | null = null;

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  return {
    invalidate,
    async refresh(
      load: (signal: AbortSignal) => Promise<number | null>,
      commit: (count: number) => void,
    ) {
      invalidate();
      const requestGeneration = generation;
      const requestController = new AbortController();
      controller = requestController;
      try {
        const count = await load(requestController.signal);
        if (requestController.signal.aborted || requestGeneration !== generation) return;
        if (count !== null && Number.isSafeInteger(count) && count >= 0) commit(count);
      } catch (error) {
        if (!requestController.signal.aborted && requestGeneration === generation) throw error;
      } finally {
        if (controller === requestController) controller = null;
      }
    },
  };
}
