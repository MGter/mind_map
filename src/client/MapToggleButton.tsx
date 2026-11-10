/**
 * Sidebar footer action row: the map toggle plus a small "back to this conversation"
 * button on its right. The second button exists because leaving the map for another panel
 * (plugins, settings, …) otherwise means walking back through the map to find the session
 * you came from — this jumps straight back to it.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { SidebarFooterActionOwnerProps } from './dsh.ts'
import { activeLocale, subscribeLocale, t } from './i18n.ts'
import { closeMapPanel, currentSessionId, mapUi, openSessionInUi, reportSidebarWide } from './map-state.ts'
import styles from './mind-map.module.css'

function MapIcon(): React.JSX.Element {
  return (
    <svg className={styles['toggleIcon']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  )
}

/** Crosshair: "come back to the conversation this map was opened from". */
function BackIcon(): React.JSX.Element {
  return (
    <svg className={styles['backToCurrentIcon']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 1.8v4.2M12 18v4.2M1.8 12h4.2M18 12h4.2" />
    </svg>
  )
}

export function MapToggleButton(props: SidebarFooterActionOwnerProps): React.JSX.Element {
  const open = useSyncExternalStore(mapUi.subscribe, () => mapUi.get().open)
  // This button lives outside the overlay, so it needs its own subscription
  // to re-render when the language changes.
  const locale = useSyncExternalStore(subscribeLocale, activeLocale, activeLocale)
  const wide = props.wide
  // The map collapses the sidebar when it opens; this is how it learns whether
  // the sidebar is already a rail (the layout service has no read-only probe).
  useEffect(() => { reportSidebarWide(wide) }, [wide])
  const classNames = [wide ? styles['toggleRow'] : styles['toggleButton']]
  if (open) classNames.push(styles['toggleButtonActive'])

  const backTitle = t('map.backToCurrent')

  return (
    <div className={`${styles['toggleWrap']}${wide ? ` ${styles['toggleWrapWide']}` : ''}`}>
      <button
        type="button"
        className={classNames.filter(Boolean).join(' ')}
        lang={locale}
        title={t('map.toggle')}
        aria-label={t('map.toggle')}
        aria-pressed={open}
        onClick={() => { mapUi.toggle() }}
      >
        <MapIcon />
        {wide ? <span className={styles['toggleLabel']}>{t('map.toggle')}</span> : null}
      </button>
      <button
        type="button"
        className={styles['backToCurrent']}
        lang={locale}
        title={backTitle}
        aria-label={backTitle}
        data-mindmap-back="1"
        onClick={() => {
          const sessionId = currentSessionId()
          if (sessionId === undefined) return
          // Leaving the map panel (if it is what you are looking at) and revealing the
          // conversation is one gesture: the shell then shows that session again.
          closeMapPanel()
          openSessionInUi(sessionId)
        }}
      >
        <BackIcon />
      </button>
    </div>
  )
}
