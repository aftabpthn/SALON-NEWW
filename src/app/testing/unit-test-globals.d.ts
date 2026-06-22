declare function describe(description: string, specDefinitions: () => void): void;
declare function it(expectation: string, assertion: () => void): void;

interface UnitTestExpectation<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
}

declare function expect<T>(actual: T): UnitTestExpectation<T>;
