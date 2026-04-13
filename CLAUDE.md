## Design Context

### Users
PE/VC 투자 전문가, 기업 IR/홍보팀, 금융·컨설팅 전문가 등 복합 사용자군.
업무 중 빠르게 뉴스를 소화하고 외부에 공유하는 고밀도 정보 소비 워크플로우에서 사용.
시간 압박이 있는 전문가가 주 사용자이므로, UI는 판단을 돕되 방해하지 않아야 함.

### Brand Personality
**전문적 · 신뢰 · 간결**

### Aesthetic Direction
- 레퍼런스: Bloomberg Terminal — 높은 정보 밀도, 절제된 색상, 기능이 곧 미학
- 테마: 라이트·다크 모두 동등한 완성도
- 안티레퍼런스: 과도한 그라디언트, 장식적 일러스트, 소비자앱 스타일의 큰 여백
- 분위기: 단정하고 밀도 있는 SaaS

### Design Principles
1. **정보 우선**: 크롬(UI chrome)은 최소화, 데이터와 텍스트가 화면 주도
2. **기능이 곧 형태**: 모든 시각 요소는 기능적 이유가 있어야 함, 장식 금지
3. **신뢰를 주는 일관성**: `#1e3a5f` navy, `#d4af37` gold, `rounded-xl`/`rounded-2xl` 엄수
4. **다크·라이트 동등 완성도**: 모든 컴포넌트에 `dark:` 변형 완비
5. **액션 명확성**: Primary(`#1e3a5f`) → Secondary(outline) → Destructive(red) 3단계. 금색은 가장 중요한 단일 CTA에만

### Brand Tokens
| Token | Value | Usage |
|---|---|---|
| Navy Primary | `#1e3a5f` | Buttons, focus rings, brand anchors |
| Gold Accent | `#d4af37` | Single most-important CTA per view |
| Navy Hover | `#24456f` | Hover state for navy |
| Surface Light | `#ffffff` / `#f9fafb` | Cards and page backgrounds |
| Surface Dark | `#1f2937` / `#111827` | Dark mode cards and backgrounds |
| Text Primary | `#111827` (light) / `#f9fafb` (dark) | Body text |
| Text Muted | `#6b7280` | Secondary labels, metadata |
| Border | `#e5e7eb` (light) / `#374151` (dark) | Dividers, card borders |
| Radius Default | `rounded-xl` | Standard components |
| Radius Large | `rounded-2xl` | Panels, modals, prominent cards |
