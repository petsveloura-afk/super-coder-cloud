/**
 * Security layer (pure, unit-tested; additive). Automated scanners hammer every website with requests for files and admin
 * panels this app never has (/.env, /.git, /wp-login.php, /phpmyadmin …). They are answered with a plain 404 at the edge,
 * before any session refresh, database call or page render — less load, nothing for the scanner to learn. Real pages,
 * public forms / bookings / websites and the API never match.
 */
const PROBE = [
  /(^|\/)\.(env|git|svn|hg|ds_store|htaccess|htpasswd|aws|ssh|docker|npmrc|vscode|idea)(\/|$|\.)/i,
  /(^|\/)(wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|wordpress|wp-json)(\/|$)/i,
  /(^|\/)(phpmyadmin|pma|myadmin|adminer(\.php)?|cgi-bin|server-status|actuator|solr|jenkins|manager\/html)(\/|$)/i,
  /\.(php\d?|asp|aspx|jsp|cgi|env|ini|sql|bak|old|swp|log|yml|yaml|config|conf)$/i,
  /(^|\/)(config\.json|composer\.(json|lock)|package-lock\.json|id_rsa|backup\.(zip|tar|gz)|db\.sqlite)$/i,
  /\.\.(\/|%2f)|%00|<script/i,
];

export function isProbePath(pathname: string): boolean {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return true; // a malformed escape sequence is never a real page
  }
  return PROBE.some((r) => r.test(p));
}
