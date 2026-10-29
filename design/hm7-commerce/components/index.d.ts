/** HM7 Commerce — window.HM7. Vanilla JS, no framework. Call HM7.init(root) once per new fragment. */
export interface StageProps { /** .hm7-stage + HM7.light(stage, { radius, lampRadius, waveSpeed }) */ radius?: number }
export interface SurfacesProps { /** .cm-card · .cm-card--raised · .cm-frost · .cm-inset · .cm-wash[--ok|--warn|--sale] (tint toward the sidebar, for EdgeLight) */ variant?: 'card' | 'raised' | 'frost' | 'inset'; wash?: 'accent' | 'ok' | 'warn' | 'sale' }
export interface ButtonsProps { /** .cm-btn [--ghost|--line|--sale] [--sm|--lg|--block|--icon]; aria-busy="true" = loading; add .el for elastic press, .rv for edge glow */ variant?: 'primary' | 'ghost' | 'line' | 'sale'; size?: 'sm' | 'md' | 'lg' }
export interface TextFieldProps { /** .cm-field > label + .cm-input + .cm-field__help · HM7.shop.invalid(field, msg) / valid(field, msg) */ error?: string }
export interface SearchFieldProps { /** .cm-search (on .cm-frost or .cm-inset) + .cm-menu.is-open suggestions; stage: .hm7-glass.hm7-search */ placeholder?: string }
export interface ChipsProps { /** .cm-chip[data-cm-toggle] (aria-pressed) · stage: .hm7-glass.hm7-chip[data-hm7-toggle] */ pressed?: boolean }
export interface BadgesProps { /** .cm-badge--sale|new|ok|warn|solid · .cm-count[data-n] on a .cm-cartbtn */ tone?: 'sale' | 'new' | 'ok' | 'warn' | 'solid' }
export interface MenusProps { /** .cm-menu.hm7-morph + HM7.morph(button, menu) — the menu grows out of its button · stage: .hm7-glass.hm7-menu / .hm7-selmenu */ open?: boolean }
export interface GlassRevealProps { /** class .rv (+ .is-fail / .is-warn) + HM7.init, or HM7.ui.reveal(el, 'border' | 'full'); HM7.ui.autoReveal(root?, selector = '.rv, [data-reveal]') wires later-rendered elements → { disconnect() }. Reach measured to the box edge, 70–180px; colours --hm7-rv-* (tokens reveal-*) */ mode?: 'border' | 'full'; state?: 'fail' | 'warn' }
export interface ElasticProps { /** .el (container) · .el-d + .si (dual: container .12, icon .48) */ variant?: 'simple' | 'dual' }
export interface IconMorphProps { /** .im with two children .on / .off · HM7.ui.morph(im, state?) · [data-morph] on the button */ state?: boolean }
export interface RadioProps { /** [data-radio] > .ro(.sel) with .ro-ico and .ro-chk · HM7.ui.radio(group, { onChange }) */ onChange?: (index: number, row: HTMLElement) => void }
export interface SwitchProps { /** .sw-wrap(.on) > .sw-track > .sw-knob > .sw-ico; "change" event with detail.on */ on?: boolean }
export interface HeaderProps { /** .cm-frost.cm-header with .cm-search and .cm-cartbtn[data-cm-cart] */ sticky?: boolean }
export interface BottomNavProps { /** .hm7-glass.cm-frost.hm7-tabs.cm-bottom + HM7.lensTabs(bar, { onChange }) */ onChange?: (index: number) => void }
export interface FluidTabsProps { /** .cm-tabs.tb-wrap > .tb-ind + .tb-it · HM7.ui.tabs(bar, { onChange }) */ onChange?: (index: number) => void }
export interface PageTransitionProps { /** HM7.ui.pages().open(main, next, { stagger }) / .back(main, next) */ stagger?: string }
export interface CheckoutStepsProps { /** ol.cm-steps[data-cm="steps"] > li > .cm-steps__dot · HM7.shop.steps(ol).go(i) / next() / prev() */ current?: number }
export interface ProductCardProps { /** article.cm-product[data-cm-product] · .cm-fav[data-cm="fav"] · .cm-add[data-cm="add"] (flies to [data-cm-cart]) */ out?: boolean }
export interface PriceRatingProps { /** .cm-price(.cm-price--sale|--lg) > .cm-price__was + .cm-price__now · .cm-rating > .cm-stars[style=--r] · HM7.shop.money(n) */ value: number; was?: number; rating?: number }
export interface BuyBoxProps { /** price + qty + .cm-btn--lg add; HM7.shop.fly(from, to, { onArrive }) + HM7.shop.toast(host, o) */ max?: number }
export interface QuantityStepperProps { /** [data-cm="qty"] data-min data-max data-value data-removable · HM7.shop.qty(el, { onChange, onRemove, onMax }) */ min?: number; max?: number; value?: number; removable?: boolean; onChange?: (v: number) => void; onRemove?: () => void }
export interface CartLinesProps { /** .cm-list > .hm7-notif-row > .hm7-notif.cm-line + .hm7-notif__act · HM7.swipeDismiss(card, { stage, onDismiss, onAction }) · HM7.clearAll(items) */ onDismiss?: () => void }
export interface DropToCartProps { /** .hm7-stage with .hm7-folder (the bag) + .hm7-icon[data-drag] · HM7.iconDrag(stage, { onDrop }) */ onDrop?: (icon: HTMLElement) => void }
export interface FlashDealProps { /** .cm-flash.hm7-device > .hm7-stage · [data-cm="countdown"] data-end · .cm-meter --p · HM7.edgeGlow(frame, level) */ end?: number | string; sold?: number }
export interface ToastsProps { /** HM7.shop.toast(host, { title, text, icon, tint, action, onAction, life }) → swipe api */ life?: number }
export interface PriceFilterProps { /** HM7.particleSlider(el, { value, onInput, label, icon }) on a .hm7-stage sheet */ value?: number; onInput?: (v: number) => void }
export interface CategoryLampsProps { /** .hm7-glass.hm7-press.hm7-cc-btn[data-hm7-toggle][data-hm7-tint] + HM7.light(stage) */ tint?: string }
export interface PromoWidgetProps { /** HM7.bounceCard(el, { k: 115, c: 7, tilt: 10 }); inner buttons keep their clicks */ k?: number; c?: number }
export interface SkeletonProps { /** .cm-skel(--line|--media) → swap for content with .is-loaded */ }
export interface EmptyStateProps { /** .cm-empty > .cm-empty__art + h3 + p + action */ }
export interface QuickActionsProps { /** .hm7-cluster.cm-cluster[data-spacing] + HM7.cluster(root, { spacing }) — glass buttons grow out of the toggle; bridges break at `spacing` */ spacing?: number; onToggle?: (open: boolean) => void }
export interface NavDockProps { /** .hm7-dock.cm-dock > .hm7-dock__acc (mini-cart) + .hm7-dock__bar (lens tabs) · HM7.dock(dock, { scroller, threshold: 28 }) */ threshold?: number; onChange?: (minimised: boolean) => void }
export interface SoundCuesProps { /** HM7.sound.enable(on) · HM7.haptics.enable(on) · HM7.cue(name) · HM7.onCue(fn) — synthesised, no files */ enabled?: boolean }
export interface GlassModesProps { /** <html data-hm7-transparency="reduce" data-hm7-contrast="more"> — mirrors prefers-reduced-transparency / prefers-contrast; forced-colors handled */ transparency?: 'reduce'; contrast?: 'more' }
export interface EdgeLightProps { /** div.hm7-edge beside (not inside) the sidebar, style --edge-at = sidebar width · HM7.edgeLight(edge, { reach: 280 }) → { destroy() } · HM7.rim(toolbar, 'ring' | 'bottom') → the .hm7-rim element */ reach?: number; side?: 'ring' | 'bottom' }
export interface FieldMotionProps { /** HM7.fieldMotion(root = document) → { destroy() }: spring k=420 c=17 on focus / input / press / hover + .hm7-field-slime caret flash; off under prefers-reduced-motion */ root?: Element | Document }
export interface ProgressiveBlurProps { /** HM7.progressiveBlur(host, 'top' | 'bottom') → .hm7-pblur: six backdrop layers 0.5→16px masked by band + page tint; 'top' inside a header (reaches 26px past it), 'bottom' on document.body behind a dock */ side?: 'top' | 'bottom' }
