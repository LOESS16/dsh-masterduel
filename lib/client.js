/**
 * dsh-masterduel — browser half.
 *
 * Registers a left-sidebar panel entry ("游戏王 MD") and the main panel it
 * opens. The panel embeds the host-served page at /dsh-masterduel/panel.
 *
 * Sidebar auto-collapse: the page inside the iframe owns the user preference
 * (`autoCollapseSidebar`, persisted through the host's /api/settings) and
 * announces it with a postMessage on every load and on every toggle. When it
 * says "on", this half collapses the DSH left sidebar so the panel gets the
 * full width; leaving the panel restores a sidebar that this half collapsed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-masterduel',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    // The loader hands us the real React; keep the fallback so a minimal shim
    // without hooks still renders the panel instead of crashing.
    const useEffect = typeof React.useEffect === 'function' ? React.useEffect : null;

    const name = 'masterduel';
    const inject = ['slots', 'layout'];
    const PANEL_ID = 'masterduel';
    const AUTO_COLLAPSE_TYPE = 'dsh-masterduel:auto-collapse';
    const EXIT_TYPE = 'dsh-masterduel:exit';
    const COLLAPSED_ATTR = 'data-sidebar-collapsed';

    function PanelIcon() {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            background: '#c8a96a',
            color: '#1a1a1a',
            fontSize: '10px',
            fontWeight: 700,
            lineHeight: 1,
          },
        },
        'MD',
      );
    }

    function apply(ctx) {
      const layout = ctx.layout;
      let collapsedByUs = false;

      // The frame element carries the attribute only while the sidebar is closed,
      // so this covers both the wide (rail) and narrow (auto-collapse) layouts.
      function sidebarIsClosed() {
        return document.querySelector(`[${COLLAPSED_ATTR}]`) !== null;
      }

      function collapseSidebar() {
        if (sidebarIsClosed()) return;
        layout.toggleSidebar();
        collapsedByUs = true;
      }

      function restoreSidebar() {
        if (!collapsedByUs) return;
        collapsedByUs = false;
        if (sidebarIsClosed()) layout.toggleSidebar();
      }

      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === EXIT_TYPE) {
          restoreSidebar();
          try {
            if (typeof layout.selectPanel === 'function') layout.selectPanel(null);
          } catch { /* older hosts: keep the panel open */ }
          return;
        }
        if (data.type !== AUTO_COLLAPSE_TYPE) return;
        if (data.enabled === false) restoreSidebar();
        else collapseSidebar();
      }

      // Without hooks the listener cannot follow the panel's lifetime, so it
      // stays installed; the preference still decides what happens.
      if (useEffect === null) window.addEventListener('message', onMessage);

      function Panel() {
        if (useEffect !== null) {
          useEffect(() => {
            window.addEventListener('message', onMessage);
            return () => {
              window.removeEventListener('message', onMessage);
              // Leaving the panel: give the sidebar back if it was our collapse.
              restoreSidebar();
            };
          }, []);
        }

        return h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              gap: '8px',
              padding: '12px',
              boxSizing: 'border-box',
            },
          },
          h(
            'div',
            { style: { fontSize: '13px', opacity: 0.75 } },
            '卡文 / 禁限 / 相关卡来自 master-duel-ai-advisor MCP；卡组检查支持 YDK、YDKE 或纯卡表。',
          ),
          h('iframe', {
            src: '/dsh-masterduel/panel',
            title: 'Master Duel',
            style: {
              flex: '1 1 auto',
              width: '100%',
              minHeight: 0,
              border: '1px solid var(--dsw-alias-border-l2, #2a2a33)',
              borderRadius: '10px',
              background: '#101014',
            },
          }),
          h(
            'div',
            { style: { fontSize: '12px', opacity: 0.6 } },
            '如果这里是空白，',
            h('a', { href: '/dsh-masterduel/panel', target: '_blank', rel: 'noreferrer' }, '在新标签打开面板'),
            '。',
          ),
        );
      }

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel);
      });
      ctx.slots.inject('sidebar.panellist', function* () {
        yield ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => '游戏王 MD' },
          PanelIcon,
        );
      });
    }

    return { name, inject, apply };
  },
});
