import os
import sqlite3
import pymysql
import datetime
from decimal import Decimal

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "empresa.db")

def serialize_db_cell(val):
    """Converts database values (date, datetime, Decimal, bytes) to JSON-serializable types."""
    if val is None:
        return None
    if isinstance(val, (datetime.date, datetime.datetime)):
        return val.isoformat()
    if isinstance(val, datetime.timedelta):
        return str(val)
    if isinstance(val, Decimal):
        try:
            return int(val) if val % 1 == 0 else float(val)
        except Exception:
            return float(val)
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    if isinstance(val, set):
        return list(val)
    return val

class DatabaseManager:
    def __init__(self):
        self.engine = "sqlite" # 'sqlite' or 'mysql'
        self.sqlite_path = DEFAULT_DB_PATH
        self.mysql_config = {}
        self.connection = None
        self.current_user = None
        self.is_authenticated = False
        self._ensure_sqlite_seed()

    def _ensure_sqlite_seed(self):
        """Initializes default SQLite database with schema and data matching reference images."""
        conn = sqlite3.connect(self.sqlite_path)
        cur = conn.cursor()
        
        # Disable foreign keys during initial seed so self-references can be inserted in any order
        cur.execute("PRAGMA foreign_keys = OFF;")
        
        # TRABAJADOR
        cur.execute("""
            CREATE TABLE IF NOT EXISTS TRABAJADOR (
                idtrabajador INT PRIMARY KEY,
                nombre VARCHAR(50),
                tarifahr DECIMAL(5,2),
                oficio VARCHAR(20),
                telefono VARCHAR(12),
                idsupv INT,
                FOREIGN KEY (idsupv) REFERENCES TRABAJADOR(idtrabajador)
            );
        """)
        
        # EDIFICIO
        cur.execute("""
            CREATE TABLE IF NOT EXISTS EDIFICIO (
                idedificio INT PRIMARY KEY,
                direccion VARCHAR(70),
                tipo VARCHAR(30),
                nivelcalidad INT,
                categoria INT
            );
        """)
        
        # ASIGNACION
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ASIGNACION (
                idtrabajador INT,
                idedificio INT,
                fechainicio DATE,
                numdias INT,
                PRIMARY KEY (idtrabajador, idedificio, fechainicio),
                FOREIGN KEY (idtrabajador) REFERENCES TRABAJADOR(idtrabajador),
                FOREIGN KEY (idedificio) REFERENCES EDIFICIO(idedificio)
            );
        """)
        
        # Check if TRABAJADOR has rows
        cur.execute("SELECT COUNT(*) FROM TRABAJADOR;")
        if cur.fetchone()[0] == 0:
            trabajadores = [
                (1235, 'M Faraday', 12.5, 'Electricista', None, 1311),
                (1412, 'C Nemo', 13.75, 'Fontanero', None, 1520),
                (2920, 'R Garret', 10.0, 'Albañil', None, 2920),
                (3231, 'P Mason', 17.4, 'Carpintero', None, 3231),
                (1520, 'H Rickover', 11.75, 'Fontanero', None, 1520),
                (1311, 'C Coulomb', 15.5, 'Electricista', None, 1311),
                (3001, 'J Barrister', 8.2, 'Carpintero', None, 3231)
            ]
            cur.executemany("""
                INSERT INTO TRABAJADOR (idtrabajador, nombre, tarifahr, oficio, telefono, idsupv)
                VALUES (?, ?, ?, ?, ?, ?);
            """, trabajadores)

        # Check if EDIFICIO has rows
        cur.execute("SELECT COUNT(*) FROM EDIFICIO;")
        if cur.fetchone()[0] == 0:
            edificios = [
                (111, '123 Main St', 'Oficina', 4, 1),
                (210, '456 Oak Ave', 'Residencial', 3, 2),
                (312, '789 Elm Blvd', 'Comercial', 5, 3),
                (435, '101 Pine Rd', 'Industrial', 2, 1)
            ]
            cur.executemany("""
                INSERT INTO EDIFICIO (idedificio, direccion, tipo, nivelcalidad, categoria)
                VALUES (?, ?, ?, ?, ?);
            """, edificios)

        # Check if ASIGNACION has rows
        cur.execute("SELECT COUNT(*) FROM ASIGNACION;")
        if cur.fetchone()[0] == 0:
            asignaciones = [
                (1235, 111, '2023-01-15', 5),
                (1412, 111, '2023-01-20', 10),
                (2920, 210, '2023-02-01', 14),
                (3231, 312, '2023-02-15', 7),
                (1520, 312, '2023-03-01', 12),
                (1311, 435, '2023-03-10', 8),
                (3001, 210, '2023-03-15', 20)
            ]
            cur.executemany("""
                INSERT INTO ASIGNACION (idtrabajador, idedificio, fechainicio, numdias)
                VALUES (?, ?, ?, ?);
            """, asignaciones)

        conn.commit()
        conn.close()

    def authenticate(self, engine, user, password, host="localhost", port=3306, database="empresa"):
        """Validates credentials and establishes database connection with comprehensive diagnostics."""
        self.engine = engine.lower()
        if self.engine == "mysql":
            try:
                conn = pymysql.connect(
                    host=host,
                    port=int(port) if port else 3306,
                    user=user,
                    password=password,
                    database=database if database else None,
                    cursorclass=pymysql.cursors.DictCursor,
                    connect_timeout=4
                )
                self.connection = conn
                self.current_user = user
                self.is_authenticated = True
                self.current_database = database if database else "mysql"
                self.mysql_config = {
                    "host": host,
                    "port": int(port) if port else 3306,
                    "user": user,
                    "database": self.current_database
                }
                return {
                    "success": True,
                    "message": f"Conexión exitosa a MySQL ({user}@{host}:{port})",
                    "database": self.current_database,
                    "user": self.current_user
                }
            except pymysql.MySQLError as e:
                self.is_authenticated = False
                code = e.args[0] if len(e.args) > 0 and isinstance(e.args[0], int) else 0
                err_msg = e.args[1] if len(e.args) > 1 else str(e)

                # Categorize error and provide friendly remediation
                category = "Error de Conexión MySQL"
                suggestion = "Verifique la configuración del servidor, usuario, contraseña y permisos de red."

                if code == 2003 or "Connection refused" in err_msg or "Can't connect" in err_msg:
                    category = "Servidor Inaccesible (Error 2003)"
                    suggestion = f"No se pudo conectar al servidor MySQL en '{host}:{port}'. Verifique que el servicio de base de datos (mariadb/mysqld) esté activo y escuchando en ese puerto."
                elif code == 1045 or "Access denied" in err_msg:
                    category = "Acceso Denegado (Error 1045)"
                    suggestion = f"El usuario '{user}' o la contraseña son incorrectos para el servidor MySQL. Compruebe que la contraseña coincida y que el usuario tenga privilegios de conexión."
                elif code == 1049 or "Unknown database" in err_msg:
                    category = "Base de Datos No Encontrada (Error 1049)"
                    suggestion = f"La base de datos '{database}' no existe en el servidor. Puede crearla previamente o conectarse sin especificar base de datos."
                elif "timed out" in err_msg.lower():
                    category = "Tiempo de Espera Agotado"
                    suggestion = f"Se agotó el tiempo límite de espera al conectar con '{host}:{port}'. Compruebe que la dirección IP sea correcta y que no haya bloqueos por firewall."
                elif "clientconn.close" in err_msg.lower() or "http2" in err_msg.lower() or "connection force closed" in err_msg.lower():
                    category = "Conexión Interrumpida (HTTP/2 ClientConn.Close)"
                    suggestion = "La conexión de transporte continuo (stream) fue cerrada de forma forzada por timeout, proxy o inestabilidad de red. Reintente la solicitud."

                return {
                    "success": False,
                    "error_code": code,
                    "category": category,
                    "message": err_msg,
                    "suggestion": suggestion,
                    "details": f"Host: {host}:{port} | Base de datos: {database or '(ninguna)'} | Usuario: {user}"
                }
            except Exception as e:
                self.is_authenticated = False
                return {
                    "success": False,
                    "error_code": 9999,
                    "category": "Error Inesperado",
                    "message": str(e),
                    "suggestion": "Ocurrió un error inesperado al intentar inicializar el conector MySQL.",
                    "details": f"Host: {host}:{port}"
                }
        else:
            # SQLite / Local validation with rich error handling
            if not user or not user.strip():
                return {
                    "success": False,
                    "error_code": 1001,
                    "category": "Campo de Usuario Vacío (Error 1001)",
                    "message": "El nombre de usuario es obligatorio para iniciar la sesión.",
                    "suggestion": "Ingrese su nombre de usuario asignado (ejemplo: 'admin' para la cuenta predeterminada).",
                    "details": "Motor: SQLite Embebido | Archivo: empresa.db | Estado: Esperando credenciales"
                }
            if not password or not password.strip():
                return {
                    "success": False,
                    "error_code": 1004,
                    "category": "Contraseña Requerida (Error 1004)",
                    "message": "Debe especificar la contraseña correspondiente a la cuenta.",
                    "suggestion": "Ingrese la clave de acceso. Para el usuario 'admin' en el entorno local, use 'admin123'.",
                    "details": f"Usuario: {user.strip()} | Motor: SQLite Embebido"
                }
            if user.strip().lower() == "admin" and password != "admin123":
                return {
                    "success": False,
                    "error_code": 1003,
                    "category": "Credenciales No Coinciden (Error 1003)",
                    "message": f"La contraseña proporcionada es incorrecta para el usuario '{user.strip()}'.",
                    "suggestion": "Verifique el bloqueo de mayúsculas. Para el usuario predeterminado use 'admin123'.",
                    "details": f"Usuario: {user.strip()} | Motor: SQLite Local"
                }
            if not os.path.exists(self.sqlite_path):
                return {
                    "success": False,
                    "error_code": 1002,
                    "category": "Archivo de Base de Datos Ausente (Error 1002)",
                    "message": f"No se encontró el archivo local de base de datos: {self.sqlite_path}",
                    "suggestion": "La base de datos se inicializará y reconstruirá automáticamente con los esquemas y datos iniciales.",
                    "details": f"Ruta esperada: {self.sqlite_path}"
                }
            self.current_user = user.strip()
            self.is_authenticated = True
            self.current_database = "empresa"
            return {
                "success": True,
                "message": f"Conexión exitosa autenticada como '{self.current_user}'",
                "database": self.current_database,
                "user": self.current_user
            }

    def get_connection(self):
        if self.engine == "mysql":
            return self.connection
        else:
            conn = sqlite3.connect(self.sqlite_path)
            conn.row_factory = sqlite3.Row
            return conn

    def execute_query(self, sql_query):
        """Executes any SQL query and returns column names and row data."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado. Por favor inicie sesión."}

        sql = sql_query.strip()
        if not sql:
            return {"success": False, "error": "Consulta SQL vacía."}

        # Handle USE command: instruct application to direct to authentication panel
        clean_upper = sql.rstrip(';').strip().upper()
        if clean_upper.startswith("USE ") or clean_upper == "USE":
            target_db = sql.rstrip(';').strip()[4:].strip() if len(sql.rstrip(';').strip()) > 3 else ""
            return {
                "success": False,
                "is_use_command": True,
                "target_database": target_db,
                "error": f"Para cambiar a la base de datos '{target_db or 'solicitada'}' mediante USE, debe ingresar sus credenciales en el panel de autenticación."
            }

        try:
            if self.engine == "mysql":
                cur = self.connection.cursor()
                cur.execute(sql)
                if cur.description:
                    columns = [d[0] for d in cur.description]
                    rows = cur.fetchall()
                    row_list = []
                    for r in rows:
                        row_list.append([serialize_db_cell(r[c]) for c in columns])
                    return {"success": True, "columns": columns, "rows": row_list, "rowCount": len(row_list)}
                else:
                    self.connection.commit()
                    return {"success": True, "columns": ["Filas afectadas"], "rows": [[cur.rowcount]], "rowCount": cur.rowcount}
            else:
                conn = self.get_connection()
                cur = conn.cursor()
                exec_sql = sql
                if clean_upper == "SHOW TABLES":
                    exec_sql = "SELECT name AS Tables_in_empresa FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
                elif clean_upper.startswith("SHOW TABLES LIKE "):
                    pat = sql.rstrip(';').strip()[17:].strip()
                    exec_sql = f"SELECT name AS Tables_in_empresa FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name LIKE {pat} ORDER BY name;"
                elif clean_upper.startswith("SHOW COLUMNS FROM ") or clean_upper.startswith("DESCRIBE ") or clean_upper.startswith("DESC "):
                    tname = clean_upper.replace("SHOW COLUMNS FROM ", "").replace("DESCRIBE ", "").replace("DESC ", "").strip().strip("`'\"")
                    exec_sql = f"PRAGMA table_info({tname});"

                cur.execute(exec_sql)
                if cur.description:
                    columns = [d[0] for d in cur.description]
                    raw_rows = cur.fetchall()
                    rows = []
                    for r in raw_rows:
                        rows.append([serialize_db_cell(r[col]) for col in columns])
                    conn.close()
                    return {"success": True, "columns": columns, "rows": rows, "rowCount": len(rows)}
                else:
                    conn.commit()
                    affected = cur.rowcount
                    conn.close()
                    return {"success": True, "columns": ["Filas afectadas"], "rows": [[affected]], "rowCount": affected}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_schema_for_er(self):
        """Introspects tables, columns, primary keys and foreign keys for ER diagram."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado"}

        try:
            tables_data = []
            relations = []

            if self.engine == "sqlite":
                conn = self.get_connection()
                cur = conn.cursor()
                cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
                tables = [r[0] for r in cur.fetchall()]

                for tname in tables:
                    cur.execute(f"PRAGMA table_info({tname});")
                    col_info = cur.fetchall()
                    cols = []
                    pks = []
                    for c in col_info:
                        cid, cname, ctype, notnull, dflt_value, pk = c
                        is_pk = bool(pk)
                        if is_pk:
                            pks.append(cname)
                        cols.append({
                            "name": cname,
                            "type": ctype if ctype else "TEXT",
                            "is_pk": is_pk,
                            "is_fk": False
                        })

                    # Foreign keys
                    cur.execute(f"PRAGMA foreign_key_list({tname});")
                    fks = cur.fetchall()
                    for fk in fks:
                        # id, seq, table, from, to, on_update, on_delete, match
                        _, _, to_table, from_col, to_col, _, _, _ = fk
                        for col in cols:
                            if col["name"] == from_col:
                                col["is_fk"] = True
                        relations.append({
                            "from_table": tname,
                            "from_col": from_col,
                            "to_table": to_table,
                            "to_col": to_col
                        })

                    tables_data.append({
                        "name": tname,
                        "columns": cols,
                        "primary_keys": pks
                    })
                conn.close()

            else:
                # MySQL schema introspection
                cur = self.connection.cursor()
                db_name = self.mysql_config.get("database", "empresa")
                cur.execute(f"""
                    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, COLUMN_KEY
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = '{db_name}';
                """)
                rows = cur.fetchall()
                t_map = {}
                for r in rows:
                    tname = r["TABLE_NAME"]
                    if tname not in t_map:
                        t_map[tname] = {"name": tname, "columns": [], "primary_keys": []}
                    is_pk = (r["COLUMN_KEY"] == "PRI")
                    cname = r["COLUMN_NAME"]
                    if is_pk:
                        t_map[tname]["primary_keys"].append(cname)
                    t_map[tname]["columns"].append({
                        "name": cname,
                        "type": r["COLUMN_TYPE"].upper(),
                        "is_pk": is_pk,
                        "is_fk": False
                    })

                # Foreign keys
                cur.execute(f"""
                    SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = '{db_name}' AND REFERENCED_TABLE_NAME IS NOT NULL;
                """)
                fk_rows = cur.fetchall()
                for fk in fk_rows:
                    tname = fk["TABLE_NAME"]
                    from_col = fk["COLUMN_NAME"]
                    to_table = fk["REFERENCED_TABLE_NAME"]
                    to_col = fk["REFERENCED_COLUMN_NAME"]
                    if tname in t_map:
                        for col in t_map[tname]["columns"]:
                            if col["name"] == from_col:
                                col["is_fk"] = True
                    relations.append({
                        "from_table": tname,
                        "from_col": from_col,
                        "to_table": to_table,
                        "to_col": to_col
                    })
                tables_data = list(t_map.values())

            return {"success": True, "tables": tables_data, "relations": relations}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_tables(self):
        """Returns list of all table names in the current database."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado"}
        try:
            if self.engine == "sqlite":
                conn = self.get_connection()
                cur = conn.cursor()
                cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
                tables = [r[0] for r in cur.fetchall()]
                conn.close()
                return {"success": True, "tables": tables}
            else:
                cur = self.connection.cursor()
                db_name = self.mysql_config.get("database", "empresa")
                cur.execute(f"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '{db_name}';")
                tables = [r["TABLE_NAME"] for r in cur.fetchall()]
                return {"success": True, "tables": tables}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def crud_insert(self, table_name, data_dict):
        """Creates a new record in the specified table."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado"}
        try:
            cols = list(data_dict.keys())
            vals = [data_dict[c] for c in cols]
            placeholders = ", ".join(["?" if self.engine == "sqlite" else "%s"] * len(cols))
            col_names = ", ".join([f"`{c}`" for c in cols])
            sql = f"INSERT INTO `{table_name}` ({col_names}) VALUES ({placeholders});"

            if self.engine == "sqlite":
                conn = self.get_connection()
                cur = conn.cursor()
                cur.execute(sql, vals)
                conn.commit()
                conn.close()
            else:
                cur = self.connection.cursor()
                cur.execute(sql, vals)
                self.connection.commit()
            return {"success": True, "message": "Registro agregado exitosamente"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def crud_update(self, table_name, pk_dict, data_dict):
        """Updates an existing record matching primary keys."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado"}
        try:
            set_parts = []
            vals = []
            placeholder = "?" if self.engine == "sqlite" else "%s"
            for k, v in data_dict.items():
                set_parts.append(f"`{k}` = {placeholder}")
                vals.append(v)
            where_parts = []
            for k, v in pk_dict.items():
                where_parts.append(f"`{k}` = {placeholder}")
                vals.append(v)

            sql = f"UPDATE `{table_name}` SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)};"
            if self.engine == "sqlite":
                conn = self.get_connection()
                cur = conn.cursor()
                cur.execute(sql, vals)
                conn.commit()
                conn.close()
            else:
                cur = self.connection.cursor()
                cur.execute(sql, vals)
                self.connection.commit()
            return {"success": True, "message": "Registro actualizado exitosamente"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def crud_delete(self, table_name, pk_dict):
        """Deletes a record matching primary keys."""
        if not self.is_authenticated:
            return {"success": False, "error": "No autenticado"}
        try:
            placeholder = "?" if self.engine == "sqlite" else "%s"
            where_parts = []
            vals = []
            for k, v in pk_dict.items():
                where_parts.append(f"`{k}` = {placeholder}")
                vals.append(v)
            sql = f"DELETE FROM `{table_name}` WHERE {' AND '.join(where_parts)};"

            if self.engine == "sqlite":
                conn = self.get_connection()
                cur = conn.cursor()
                cur.execute(sql, vals)
                conn.commit()
                conn.close()
            else:
                cur = self.connection.cursor()
                cur.execute(sql, vals)
                self.connection.commit()
            return {"success": True, "message": "Registro eliminado exitosamente"}
        except Exception as e:
            return {"success": False, "error": str(e)}
