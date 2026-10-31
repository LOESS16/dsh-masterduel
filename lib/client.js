/**
 * dsh-masterduel — browser half.
 *
 * Registers a left-sidebar panel entry ("游戏王 MD") and the main panel it
 * opens. The panel embeds the host-served page at /dsh-masterduel/panel.
 */
window.__ModuleLoader__.load({
  id: 'dsh-masterduel',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const name = 'masterduel';
    const inject = ['slots'];
    const PANEL_ID = 'masterduel';

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

    function Panel() {
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

    function apply(ctx) {
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
