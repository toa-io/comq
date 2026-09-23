import * as mock from 'jest-mock'

// The test files are written against Jest's mock types, and keep being: the mocks are still
// Jest's, taken as the standalone `jest-mock` package. This is what @types/jest declared of it.

declare global {

  namespace jest {

    type Mock<T extends mock.FunctionLike = mock.UnknownFunction> = mock.Mock<T>

    type Mocked<T extends object> = mock.Mocked<T>

    type MockedClass<T extends mock.ClassLike> = mock.MockedClass<T>

    type MockedFunction<T extends mock.FunctionLike = mock.UnknownFunction> = mock.MockedFunction<T>

    type MockedFn<T extends mock.FunctionLike = mock.UnknownFunction> = mock.MockedFunction<T>

    type MockedObject<T extends object> = mock.MockedObject<T>
  }
}
