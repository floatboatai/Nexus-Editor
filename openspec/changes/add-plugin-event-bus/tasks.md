## 1. Core Implementation
- [ ] 1.1 Add `PluginEventBus` class to `event-emitter.ts` with typed event support
- [ ] 1.2 Add `getEventBus()` to `EditorAPI` interface and implementation
- [ ] 1.3 Add `onInit` to `NexusPlugin` interface
- [ ] 1.4 Call `onInit` for each plugin after editor construction
- [ ] 1.5 Emit `document.change`, `focus`, `blur`, `selection.change` on bus

## 2. Tests
- [ ] 2.1 Test plugin subscribes to document.change in onInit
- [ ] 2.2 Test plugin emits custom event
- [ ] 2.3 Test unsubscribe stops delivery
- [ ] 2.4 Test multiple plugins on same event

## 3. Export
- [ ] 3.1 Export `PluginEventBus` type from core index
- [ ] 3.2 `pnpm --filter @floatboat/nexus-core build`

## 4. Verification
- [ ] 4.1 `pnpm test` all green
- [ ] 4.2 No new runtime dependencies
