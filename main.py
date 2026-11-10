import os
import sys
import json
import argparse
import gi

gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')
from gi.repository import Gtk, WebKit, GLib, Gio

from database import DatabaseManager, serialize_db_cell

APP_DIR = os.path.dirname(os.path.abspath(__file__))

def build_full_html(auto_connect=False, view_override=None, dark_mode=False, test_auth_error=False, open_sidebar=False, open_sql_modal=False, test_query=None, execute_query=False):
    """Combines HTML, CSS, and JS into a single fast-loading self-contained payload."""
    html_path = os.path.join(APP_DIR, "index.html")
    css_path = os.path.join(APP_DIR, "style.css")
    js_path = os.path.join(APP_DIR, "app.js")

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()

    # Replace css link with inline style
    html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')

    # Add auto_connect flag if requested
    injection = ""
    if auto_connect and not test_auth_error:
        injection += "<script>window.__AUTO_CONNECT__ = true;</script>\n"
    if dark_mode:
        injection += "<script>window.addEventListener('DOMContentLoaded', () => { setTimeout(toggleTheme, 80); });</script>\n"
    if test_auth_error:
        injection += "<script>window.addEventListener('DOMContentLoaded', () => { setTimeout(() => { setAuthEngine('mysql'); document.getElementById('authPass').value = 'wrong'; submitAuthentication(); }, 150); });</script>\n"
    elif view_override:
        injection += f"<script>window.__AUTO_VIEW__ = '{view_override}';</script>\n"

    if test_query:
        safe_q = json.dumps(test_query)
        if execute_query:
            injection += f"<script>window.addEventListener('DOMContentLoaded', () => {{ setTimeout(async () => {{ setSqlInputValue({safe_q}); await runQueryFromInput(); }}, 700); }});</script>\n"
        else:
            injection += f"<script>window.addEventListener('DOMContentLoaded', () => {{ setTimeout(() => {{ setSqlInputValue({safe_q}); }}, 700); }});</script>\n"

    # Replace script link with inline script and injection
    script_bundle = f"{injection}<script>\n{js}\n"
    if open_sidebar:
        script_bundle += "\nwindow.addEventListener('DOMContentLoaded', () => { setTimeout(() => { switchView('er'); toggleErSidebar(); }, 400); });\n"
    elif open_sql_modal:
        script_bundle += "\nwindow.addEventListener('DOMContentLoaded', () => { setTimeout(async () => { switchView('er'); await openSqlCodeModal(); }, 600); });\n"
    elif view_override and not test_auth_error:
        script_bundle += f"\nwindow.addEventListener('DOMContentLoaded', () => {{ setTimeout(() => switchView('{view_override}'), 200); }});\n"
    script_bundle += "</script>"

    html = html.replace('<script src="app.js"></script>', script_bundle)
    return html

def main():
    parser = argparse.ArgumentParser(description="HolaMundo02 - Autenticación y Consulta SQL Desktop App")
    parser.add_argument("--screenshot", type=str, default=None, help="Save PNG screenshot to file and exit")
    parser.add_argument("--view", type=str, default="query", choices=["query", "er", "crud"], help="Initial view to display")
    parser.add_argument("--dark", action="store_true", help="Launch in dark mode")
    parser.add_argument("--test-auth-error", action="store_true", help="Display connection error diagnostics")
    parser.add_argument("--open-sidebar", action="store_true", help="Open ER sidebar for screenshot/testing")
    parser.add_argument("--open-sql-modal", action="store_true", help="Open SQL DDL modal for screenshot/testing")
    parser.add_argument("--test-query", type=str, default=None, help="Initial SQL query to put in editor")
    parser.add_argument("--execute-query", action="store_true", help="Execute test query")
    args, _ = parser.parse_known_args()

    # Initialize Database Manager
    db = DatabaseManager()

    # Create GTK4 application
    app = Gtk.Application(application_id=f"org.holamundo02.app{os.getpid()}", flags=Gio.ApplicationFlags.NON_UNIQUE)

    def on_activate(gtk_app):
        win = Gtk.ApplicationWindow(application=gtk_app)
        win.set_title("HolaMundo02 - Autenticación, Consulta SQL, CRUD y Diagrama ER")
        win.set_default_size(1200, 750)

        # Setup WebKit UserContentManager and message handler
        ucm = WebKit.UserContentManager()
        ucm.register_script_message_handler("api")

        def on_script_message(manager, js_result):
            try:
                raw_json = js_result.to_string()
                msg = json.loads(raw_json)
                req_id = msg.get("id")
                action = msg.get("action")
                payload = msg.get("payload", {})

                response = {"success": False, "error": "Acción desconocida"}

                if action == "authenticate":
                    engine = payload.get("engine", "sqlite")
                    user = payload.get("user", "")
                    password = payload.get("password", "")
                    host = payload.get("host", "localhost")
                    port = payload.get("port", 3306)
                    database = payload.get("database", "empresa")
                    response = db.authenticate(engine, user, password, host, port, database)

                elif action == "execute_query":
                    sql = payload.get("sql", "")
                    response = db.execute_query(sql)

                elif action == "get_schema":
                    response = db.get_schema_for_er()

                elif action == "crud_insert":
                    tname = payload.get("table")
                    data = payload.get("data")
                    response = db.crud_insert(tname, data)

                elif action == "crud_update":
                    tname = payload.get("table")
                    pk = payload.get("pk")
                    data = payload.get("data")
                    response = db.crud_update(tname, pk, data)

                elif action == "crud_delete":
                    tname = payload.get("table")
                    pk = payload.get("pk")
                    response = db.crud_delete(tname, pk)

                elif action == "get_tables":
                    response = db.get_tables()

                # Send response back to JavaScript safely serialized
                safe_json = json.dumps(response, default=serialize_db_cell)
                js_callback = f"window.__onPythonResponse({req_id}, {safe_json});"
                web_view.evaluate_javascript(js_callback, -1, None, None, None, None)

            except Exception as e:
                print(f"[Python Bridge Error]: {e}", file=sys.stderr)

        ucm.connect("script-message-received::api", on_script_message)

        # Create WebView with user content manager
        web_view = WebKit.WebView(user_content_manager=ucm)
        win.set_child(web_view)
        win.present()

        # Build combined HTML payload
        is_screenshot = bool(args.screenshot)
        html_content = build_full_html(
            auto_connect=is_screenshot,
            view_override=args.view if is_screenshot else None,
            dark_mode=args.dark,
            test_auth_error=args.test_auth_error,
            open_sidebar=args.open_sidebar,
            open_sql_modal=args.open_sql_modal,
            test_query=args.test_query,
            execute_query=args.execute_query
        )
        web_view.load_html(html_content, f"file://{APP_DIR}/")

        # Handle screenshot capturing
        if args.screenshot:
            screenshot_path = os.path.abspath(args.screenshot)
            os.makedirs(os.path.dirname(screenshot_path), exist_ok=True)

            def on_load_changed(view, event):
                if event == WebKit.LoadEvent.FINISHED:
                    # Wait for 120 frames / ~1500ms for animations and layout to settle
                    def do_capture():
                        def on_snapshot_done(source, result):
                            try:
                                texture = source.get_snapshot_finish(result)
                                texture.save_to_png(screenshot_path)
                                print(f"[SUCCESS]: Screenshot successfully saved to {screenshot_path}")
                            except Exception as err:
                                print(f"[ERROR]: Failed to capture screenshot: {err}", file=sys.stderr)
                            finally:
                                os._exit(0)

                        view.get_snapshot(WebKit.SnapshotRegion.FULL_DOCUMENT, WebKit.SnapshotOptions.NONE, None, on_snapshot_done)

                    capture_delay = 1300 if (args.test_query or args.open_sidebar or args.open_sql_modal) else 800
                    GLib.timeout_add(capture_delay, do_capture)

            web_view.connect("load-changed", on_load_changed)

    app.connect("activate", on_activate)
    app.run([])

if __name__ == "__main__":
    main()
