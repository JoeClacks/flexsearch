/**
 * A @libsql/client handle shaped like the node-sqlite3 one this adapter drives.
 *
 * Pass the result as `db` in SqliteDB's config:
 *
 *     import { createClient } from "@libsql/client";
 *     import libsqlHandle from "flexsearch/db/sqlite/libsql";
 *     const db = libsqlHandle(createClient({ url: "file:index.sqlite" }));
 *     const store = new SqliteDB("recipes", { db });
 *
 * The adapter's driver surface is get, all, run, exec, parallelize and close.
 *
 * Two things this has to reconcile.
 *
 * Ordering. Statements are queued and run one at a time, because node-sqlite3
 * serialises on a single connection and the adapter leans on that: `run()` is
 * called without a callback and without being awaited, repeatedly, and then
 * BEGIN and COMMIT are expected to land around those writes. Concurrent
 * promises would let a write escape its transaction.
 *
 * Transactions. libsql refuses BEGIN/COMMIT through execute() -- it owns
 * transactions through client.transaction(). So those statements are
 * intercepted and translated, and everything issued in between is routed to the
 * transaction object rather than the client.
 */

const BEGIN = /^\s*BEGIN\b/i,
      COMMIT = /^\s*(COMMIT|END)\b/i,
      ROLLBACK = /^\s*ROLLBACK\b/i;


/**
 * @param {!Object} client A @libsql/client instance.
 * @return {!Object} A handle exposing the node-sqlite3 driver surface.
 */
export default function libsqlHandle(client) {
    let queue = Promise.resolve(),
        tx = null;


    function noop() {}

    function enqueue(task) {
        const run = queue.then(task, task);

        queue = run.then(noop, noop);
        return run;
    }

    /** Statements route to the transaction while one is open. */
    function target() {
        return tx || client;
    }

    /**
     * node-sqlite3 accepts (sql, cb), (sql, params, cb) and (sql, params).
     * @return {!Array}
     */
    function args(params, callback) {
        return "function" == typeof params ? [[], params] : [params || [], callback];
    }

    /**
     * A failed statement with no callback is reported, not thrown:
     * node-sqlite3 surfaces those on the Database's "error" event rather than
     * throwing, and most of the adapter's run() calls pass no callback, so
     * rethrowing would turn one failed write into a process-killing unhandled
     * rejection.
     */
    function settle(cb, sql) {
        return function (err) {
            if (cb) return void cb(err);
            console.error("FlexSearch libsql:", sql, err);
        };
    }

    function query(sql, params, callback, single) {

        const [values, cb] = args(params, callback);

        return enqueue(function () {
            return target().execute({ sql: sql, args: values }).then(function (result) {
                const rows = result.rows || [],
                      out = single ? rows[0] : rows;

                cb && cb(null, out);
                return out;
            }, settle(cb, sql));
        });
    }

    return {

        get(sql, params, callback) {
            return query(sql, params, callback, !0);
        },

        all(sql, params, callback) {
            return query(sql, params, callback, !1);
        },

        run(sql, params, callback) {
            return query(sql, params, callback, !1);
        },

        /**
         * sqlite3's exec runs a script that may hold several statements, and is
         * also how this adapter issues BEGIN, COMMIT and its PRAGMAs.
         */
        exec(sql, callback) {

            const cb = "function" == typeof callback ? callback : null;

            if (BEGIN.test(sql)) {
                return enqueue(function () {

                    if (tx) return void (cb && cb(null, []));
                    return client.transaction("write").then(function (handle) {
                        tx = handle;
                        cb && cb(null, []);
                    }, settle(cb, sql));
                });
            }

            if (COMMIT.test(sql) || ROLLBACK.test(sql)) {
                const rollback = ROLLBACK.test(sql);
                return enqueue(function () {
                    if (!tx) return void (cb && cb(null, []));
                    const handle = tx;
                    tx = null;
                    return Promise.resolve(rollback ? handle.rollback() : handle.commit()).then(function () {
                        cb && cb(null, []);
                    }, settle(cb, sql));
                });
            }

            const script = /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""));

            return enqueue(function () {
                const t = target(),
                      done = script && t.executeMultiple ? t.executeMultiple(sql) : t.execute(sql);

                return done.then(function (result) {
                    cb && cb(null, result && result.rows || []);
                    return result;
                }, settle(cb, sql));
            });
        },

        /**
         * node-sqlite3 toggles parallel/serial mode around the callback. Here
         * everything is queued anyway, so this just invokes it -- and it has to
         * do so synchronously: transaction() issues BEGIN, calls
         * parallelize(task), then issues COMMIT, so the task's writes must
         * reach the queue between the two.
         */
        parallelize(callback) {
            callback && callback();
        },

        serialize(callback) {
            callback && callback();
        },

        close(callback) {
            return enqueue(function () {
                return Promise.resolve(client.close()).then(function () {
                    callback && callback(null);
                }, settle(callback, "close"));
            });
        }
    };
}