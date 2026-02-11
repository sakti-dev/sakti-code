# Research Prompts for Desktop Refactor Plan

> Use these prompts with the research agent to validate the refactor plan against SolidJS best practices and clean code principles.

---

## Research Prompt 1: SolidJS State Management Best Practices

**Research Goal:** Validate our domain store pattern and context architecture against SolidJS best practices.

```
Research SolidJS state management best practices and patterns. I need to validate an architecture design:

Current design:
- Domain-based stores (MessageStore, PartStore, SessionStore) using solid-js/store
- Normalized data structure with byId and bySession indexes
- Context providers for each domain (MessageContext, PartContext, etc.)
- Components consume state via hooks (useMessageById, useSessionMessages)

Questions to research:
1. What are the recommended patterns for structuring stores in SolidJS?
2. Should we use createStore, produce, reconcile together or separately?
3. How does SolidJS's fine-grained reactivity work with nested objects?
4. What are the performance implications of large normalized stores?
5. Should stores be singletons or created per-provider instance?
6. How to handle store persistence (localStorage) with SolidJS reactivity?
7. What are the anti-patterns to avoid with solid-js/store?
8. How does SolidJS's batch API work and when should it be used?

Search for:
- "SolidJS store best practices"
- "solid-js/store normalized data"
- "SolidJS reactive state management patterns"
- "SolidJS context provider patterns"
- "SolidJS store persistence"
```

---

## Research Prompt 2: SolidJS Context Patterns

**Research Goal:** Validate our domain context approach and ensure we're following SolidJS-specific patterns.

```
Research SolidJS context and provider patterns for domain-driven state management.

Current design:
- 4 domain contexts: MessageContext, PartContext, SessionContext, UIContext
- Each context provides read operations and write operations
- Contexts use stores internally but expose clean APIs
- Components consume via hooks (useMessage, usePart, etc.)
- Minimal component props (mostly just IDs)

Questions to research:
1. How many context providers is too many in SolidJS?
2. Should we merge contexts or keep them separate by domain?
3. How does SolidJS's useContext compare to React's?
4. What are the performance implications of multiple nested providers?
5. Should we use SolidJS's createResource for async data fetching?
6. How to handle context default values and error cases?
7. What's the SolidJS way to provide both state and operations via context?
8. Are there any SolidJS-specific patterns for domain-driven contexts?

Search for:
- "SolidJS context provider best practices"
- "SolidJS useContext patterns"
- "SolidJS multiple context providers"
- "SolidJS domain driven design"
- "SolidJS context performance"
```

---

## Research Prompt 3: SolidJS Component Performance

**Research Goal:** Ensure our component patterns and memoization strategies are optimal for SolidJS.

```
Research SolidJS component performance optimization patterns.

Current design:
- Components are "dumb" - consume state from context
- Use createMemo for derived state
- Use Index component for keyed lists
- Minimal props passed to components
- Fine-grained reactivity from stores

Questions to research:
1. When should we use createMemo vs createSignal vs computed functions?
2. How does SolidJS's Index component work and when should it be used?
3. What are the performance implications of For vs Index vs map in SolidJS?
4. How does SolidJS's reactivity tracking work under the hood?
5. What causes unnecessary re-renders in SolidJS and how to avoid them?
6. How to profile and measure SolidJS component performance?
7. Are there SolidJS-specific patterns for virtual scrolling?
8. What's the recommended way to handle large lists in SolidJS?

Search for:
- "SolidJS performance optimization"
- "SolidJS createMemo vs createSignal"
- "SolidJS Index vs For component"
- "SolidJS unnecessary re-renders"
- "SolidJS large list rendering"
- "SolidJS reactivity tracking"
```

---

## Research Prompt 4: Clean Code Principles for Reactive Frameworks

**Research Goal:** Validate our "dumb components" approach and separation of concerns.

```
Research clean code principles specifically for reactive frameworks like SolidJS.

Current design:
- Components are presentational only (dumb)
- Business logic in domain stores/commands
- UI state in UIContext
- Data flows from stores → contexts → components

Questions to research:
1. What are the key clean code principles for reactive frameworks?
2. How to separate concerns in a SolidJS application?
3. Should components be "smart" or "dumb" in SolidJS?
4. What's the recommended folder structure for SolidJS apps?
5. How to organize business logic vs presentation logic in SolidJS?
6. What are the SOLID principles applied to reactive programming?
7. How to handle side effects in SolidJS components?
8. What's the recommended way to test SolidJS components?

Search for:
- "SolidJS clean code architecture"
- "SolidJS smart vs dumb components"
- "SolidJS separation of concerns"
- "SolidJS folder structure best practices"
- "SolidJS business logic organization"
- "SolidJS testing patterns"
```

---

## Research Prompt 5: Server-Sent Events (SSE) with SolidJS

**Research Goal:** Validate our streaming architecture and event handling patterns.

```
Research Server-Sent Events (SSE) patterns with SolidJS and reactive frameworks.

Current design:
- EventSource connects to /event endpoint
- Events parsed and emitted to event bus
- Event handlers update stores
- Components reactively update via store changes
- Event coalescing to batch rapid events

Questions to research:
1. What are the recommended patterns for SSE with SolidJS?
2. How to handle SSE reconnection with exponential backoff in SolidJS?
3. Should we use createResource or createEffect for SSE streams?
4. How to handle SSE cleanup and memory leaks in SolidJS?
5. What's the best way to batch SSE events in SolidJS?
6. How to handle SSE error states and recovery?
7. Should we use SolidJS's onCleanup for SSE disconnection?
8. Are there any SolidJS-specific SSE libraries or patterns?

Search for:
- "SolidJS Server-Sent Events"
- "SolidJS EventSource patterns"
- "SolidJS SSE reconnection"
- "SolidJS event streaming"
- "SolidJS reactive SSE"
```

---

## Research Prompt 6: Domain-Driven Design in Frontend Applications

**Research Goal:** Validate our domain context and aggregate patterns.

```
Research Domain-Driven Design patterns applied to frontend applications.

Current design:
- Domain-based organization (Message, Part, Session domains)
- Each domain has store, context, and operations
- Aggregates (Chat) span multiple domains
- Commands/Queries separation
- Event-driven updates via event bus

Questions to research:
1. How to apply Domain-Driven Design to frontend apps?
2. What's the recommended way to organize domains in a UI application?
3. Should domains map 1:1 to contexts or should they be different?
4. How to handle cross-domain operations in frontend DDD?
5. What are the patterns for aggregates in reactive frameworks?
6. How to design bounded contexts in a SPA?
7. Should we use CQRS (Command Query Responsibility Segregation) in frontend?
8. How to handle domain events in a frontend application?

Search for:
- "Domain-Driven Design frontend"
- "DDD single page application"
- "frontend domain organization"
- "DDD in React/SolidJS"
- "frontend bounded contexts"
- "CQRS frontend pattern"
```

---

## Research Prompt 7: TypeScript Patterns for SolidJS

**Research Goal:** Ensure our type definitions and generics usage follow best practices.

```
Research TypeScript patterns and best practices specifically for SolidJS applications.

Current design:
- Strong typing for all domain models
- Generic types for stores and contexts
- Type-safe event bus
- Discriminated unions for part types
- Accessor types from SolidJS

Questions to research:
1. What are the recommended TypeScript patterns for SolidJS?
2. How to type SolidJS stores properly?
3. How to type context providers in SolidJS with TypeScript?
4. What's the best way to type Accessor and Setter types?
5. How to handle generics in SolidJS components?
6. What are the TypeScript pitfalls specific to SolidJS?
7. How to type event-driven architectures in TypeScript?
8. Should we use utility types for store projections?

Search for:
- "SolidJS TypeScript best practices"
- "SolidJS store typing"
- "SolidJS context TypeScript"
- "SolidJS generics"
- "SolidJS Accessor types"
```

---

## Research Prompt 8: Testing Strategies for SolidJS

**Research Goal:** Ensure our architecture is testable and we have a testing strategy.

```
Research testing strategies and patterns for SolidJS applications.

Current design:
- Dumb components (easy to test with mock contexts)
- Pure domain logic (easy to unit test)
- Commands/queries (testable with mocked stores)
- Event-driven updates

Questions to research:
1. What are the recommended testing frameworks for SolidJS?
2. How to test SolidJS components with context dependencies?
3. How to mock SolidJS stores for testing?
4. What's the SolidJS equivalent of React Testing Library?
5. How to test async operations in SolidJS?
6. How to test event-driven flows in SolidJS?
7. What's the recommended way to test SolidJS reactivity?
8. How to set up integration tests for SolidJS apps?

Search for:
- "SolidJS testing framework"
- "SolidJS component testing"
- "SolidJS store testing"
- "SolidJS Testing Library"
- "SolidJS async testing"
- "SolidJS integration testing"
```

---

## Research Prompt 9: Real-world SolidJS Architectures

**Research Goal:** Learn from real-world SolidJS applications and their architectures.

```
Research real-world SolidJS applications and their architecture patterns.

Looking for:
1. Large-scale SolidJS applications and their architecture
2. How successful SolidJS apps organize state management
3. What patterns do popular SolidJS libraries use?
4. Case studies of SolidJS apps with complex state
5. Examples of SolidJS apps with real-time data
6. GitHub repositories with excellent SolidJS architecture
7. SolidJS apps that use domain-driven design
8. SolidJS apps with streaming/real-time features

Search for:
- "SolidJS large application architecture"
- "SolidJS real-world examples"
- "SolidJS case study"
- "SolidJS GitHub projects"
- "SolidJS production app"
- "SolidJS real-time application"
```

---

## Research Prompt 10: Alternative Approaches & Anti-Patterns

**Research Goal:** Validate we're not missing better approaches or falling into anti-patterns.

```
Research alternative state management approaches and common anti-patterns for SolidJS.

Current design choices:
- Custom stores with solid-js/store
- Domain-based contexts
- Event bus for SSE events
- Command pattern for operations
- Normalized data structure

Questions to research:
1. What are the alternatives to solid-js/store for state management?
2. Should we consider using SolidJS's createResource instead?
3. What are the common anti-patterns in SolidJS?
4. Should we use a state machine library (like XState) with SolidJS?
5. What are the pitfalls of normalized stores in reactive frameworks?
6. Are there better patterns for handling streaming data?
7. Should we consider using signals differently?
8. What do experienced SolidJS developers recommend against?

Search for:
- "SolidJS anti-patterns"
- "SolidJS state management alternatives"
- "SolidJS mistakes to avoid"
- "SolidJS state machine"
- "SolidJS streaming patterns"
- "SolidJS pitfalls"
```

---

## How to Use These Prompts

1. **Run in parallel** - These research tasks are independent, run them together
2. **Prioritize** - Start with Prompts 1-3 (most critical for our architecture)
3. **Document findings** - Create research summaries with key insights
4. **Update plan** - Apply findings to refactor plan as needed
5. **Check trade-offs** - Note any conflicting advice and make decisions

## Expected Outcomes

After research, we should be able to:

- ✅ Validate our domain store pattern against SolidJS best practices
- ✅ Confirm our context provider approach is optimal
- ✅ Ensure our component patterns will perform well
- ✅ Identify any SolidJS-specific optimizations we missed
- ✅ Refine our testing strategy
- ✅ Catch any anti-patterns before implementation
- ✅ Learn from real-world SolidJS architectures
