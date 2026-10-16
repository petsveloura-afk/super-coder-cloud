/*! SUPER CODER CLOUD — website chat widget.
 * <script src="https://super-coder-cloud.vercel.app/widget.js" data-org="your-workspace" data-lang="he" data-color="3366E6" async></script>
 */
(function () {
  var s = document.currentScript;
  if (!s || window.__sccChat) return;
  window.__sccChat = true;
  var org = (s.getAttribute("data-org") || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(org)) return;
  var lang = /^(he|ar|en)$/.test(s.getAttribute("data-lang") || "") ? s.getAttribute("data-lang") : "he";
  var color = (s.getAttribute("data-color") || "3366E6").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(color)) color = "3366E6";
  var base = new URL(s.src).origin;
  var rtl = lang !== "en";
  var side = rtl ? "left" : "right";

  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", rtl ? "צ׳אט" : "Chat");
  btn.style.cssText = "position:fixed;bottom:20px;" + side + ":16px;z-index:2147483646;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.25);background:#" + color + ";display:flex;align-items:center;justify-content:center;transition:transform .15s";
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  btn.onmouseenter = function () { btn.style.transform = "scale(1.06)"; };
  btn.onmouseleave = function () { btn.style.transform = "none"; };

  var frame = null;
  btn.onclick = function () {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = base + "/" + lang + "/chat/" + org + "?color=" + color;
      frame.title = "Chat";
      frame.allow = "clipboard-write";
      frame.style.cssText = "position:fixed;bottom:90px;" + side + ":16px;z-index:2147483647;width:min(390px,calc(100vw - 32px));height:min(620px,calc(100vh - 120px));border:0;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.3);background:#fff;display:block";
      document.body.appendChild(frame);
      return;
    }
    frame.style.display = frame.style.display === "none" ? "block" : "none";
  };
  if (document.body) document.body.appendChild(btn);
  else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(btn); });
})();
