/*
 * Anti-framing guard (clickjacking defence).
 *
 * The right defence is the CSP `frame-ancestors 'none'` response header, but GitHub Pages
 * cannot send custom headers and browsers ignore `frame-ancestors` in a <meta> CSP. So:
 *  - index.html keeps <body> hidden until this script marks the page as top-level;
 *  - when the page finds itself inside a frame it never shows the app, tries to replace the
 *    top window with itself, and otherwise shows only a link to open the app directly;
 *  - if this script cannot run at all (e.g. a sandboxed frame without scripts), the body
 *    simply stays hidden.
 * This is a classic (non-module) script so it runs before the page body is parsed.
 */
(function () {
  var root = document.documentElement;
  var framed;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  if (!framed) {
    root.setAttribute('data-frame-ok', '');
    return;
  }
  root.setAttribute('data-framed', '');
  try {
    window.top.location.replace(window.location.href);
  } catch {
    // Cross-origin parents usually block this without a user gesture; stay hidden instead.
  }
  document.addEventListener('DOMContentLoaded', function () {
    var zh = /^zh/i.test(navigator.language || '');
    var notice = document.createElement('p');
    notice.id = 'frame-notice';
    notice.appendChild(
      document.createTextNode(
        zh ? '本应用不能嵌入其他网站中使用。' : 'This app cannot be used inside another website. ',
      ),
    );
    var link = document.createElement('a');
    link.href = window.location.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = zh ? '直接打开' : 'Open it directly';
    notice.appendChild(link);
    document.body.appendChild(notice);
  });
})();
