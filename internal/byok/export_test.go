package byok

// NewChainForTest builds a chain over ready entries, for tests of its order.
func NewChainForTest[T any](entries []Entry[T]) *Chain[T] { return &Chain[T]{entries: entries} }
