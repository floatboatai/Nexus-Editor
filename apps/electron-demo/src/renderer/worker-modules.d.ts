declare module "*?worker&inline" {
  const WorkerCtor: { new (options?: { name?: string }): Worker };
  export default WorkerCtor;
}
