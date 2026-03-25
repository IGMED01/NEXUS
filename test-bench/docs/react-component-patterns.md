# React Component Patterns — Project Standards

## File Structure
```
src/
  components/
    Button/
      Button.jsx        # Component
      Button.test.jsx   # Tests
      index.js          # Re-export
    DataTable/
      DataTable.jsx
      useTableSort.js   # Co-located hook
      columns.js        # Column definitions
      index.js
  hooks/
    useDebounce.js      # Shared hooks
    useFetch.js
    useLocalStorage.js
```

## Component Template
```jsx
import { useState, useCallback, memo } from 'react'

/**
 * @param {Object} props
 * @param {string} props.label - Button text
 * @param {'primary'|'secondary'|'ghost'} props.variant
 * @param {boolean} props.loading
 * @param {() => void} props.onClick
 */
function Button({ label, variant = 'primary', loading = false, onClick }) {
  const handleClick = useCallback(() => {
    if (!loading) onClick?.()
  }, [loading, onClick])

  return (
    <button
      className={`btn btn-${variant}`}
      disabled={loading}
      onClick={handleClick}
    >
      {loading ? <Spinner size="sm" /> : label}
    </button>
  )
}

export default memo(Button)
```

## State Management Rules
1. **Local state** (`useState`) for UI-only state (modals, inputs, toggles)
2. **Lifted state** for parent-child communication (max 2 levels)
3. **Context** for theme, auth, locale (read-heavy, write-rare)
4. **External store** (Zustand) for complex shared state

## Custom Hook Pattern
```jsx
function useFetch(url, options = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    fetch(url, { ...options, signal: controller.signal })
      .then(res => res.json())
      .then(setData)
      .catch(err => {
        if (err.name !== 'AbortError') setError(err)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [url])

  return { data, error, loading }
}
```

## Performance Guidelines
- Use `memo()` on components that receive stable props but re-render from parent
- Use `useCallback` for event handlers passed to memoized children
- Use `useMemo` for expensive computations (sorting, filtering large arrays)
- Avoid: inline object/array literals as props (creates new reference each render)
- Lazy load routes: `const Settings = lazy(() => import('./pages/Settings'))`

## Error Boundaries
```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    logError(error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ hasError: false })} />
    }
    return this.props.children
  }
}
```

## Testing Standards
- Unit tests with Vitest + React Testing Library
- Test behavior, not implementation
- Use `screen.getByRole()` over `getByTestId()`
- Mock API calls with MSW (Mock Service Worker)
- Coverage target: 80% on critical paths

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import Button from './Button'

test('calls onClick when clicked', () => {
  const handleClick = vi.fn()
  render(<Button label="Save" onClick={handleClick} />)
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  expect(handleClick).toHaveBeenCalledOnce()
})

test('disables button when loading', () => {
  render(<Button label="Save" loading />)
  expect(screen.getByRole('button')).toBeDisabled()
})
```
