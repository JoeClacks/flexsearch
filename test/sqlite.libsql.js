// The SQLite adapter must be drivable by something other than node-sqlite3,
// which is archived. Its driver surface is Database(path) plus get/all/run/
// exec/close, so a @libsql/client wrapper suffices -- and the package must not
// be needed at all when a handle is supplied.
global.self = global;
import { expect } from "chai";
import fs from "node:fs";
import { createClient } from "@libsql/client";
let FlexSearch = await import("../src/bundle.js");
if(FlexSearch.default) FlexSearch = FlexSearch.default;
const { Document, Charset } = FlexSearch;
const SqliteDB = (await import("../src/db/sqlite/index.js")).default;
const libsqlHandle = (await import("../src/db/sqlite/libsql/index.js")).default;

const DIR = "/tmp/flexsearch-libsql-test";
const field = () => [{
    field: "name", tokenize: "forward", resolution: 9, encoder: Charset.LatinBalance
}];
const ids = (r) => (Array.isArray(r) ? r : []).flatMap(g => g.result.map(String));

let s = 42;
const rnd = (n) => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % n);
const A = ["honey","roasted","crispy","braised","spiced","sticky"];
const B = ["glazed","charred","whipped","smoked","candied"];
const C = ["carrots","parsnips","aubergine","chickpeas","squash"];
const DOCS = [];
for(let i = 0; i < 400; i++){
    const lead = Array.from({ length: rnd(5) }, (_, k) => "L" + k).join(" ");
    const pad  = Array.from({ length: rnd(5) }, (_, k) => "w" + k).join(" ");
    DOCS.push({ id: String(i), name: [lead, A[rnd(6)], pad, B[rnd(5)], C[rnd(5)]].filter(Boolean).join(" ") });
}

describe("SQLite adapter driven by @libsql/client", function(){

    let mem, lib;

    before(async function(){
        fs.rmSync(DIR, { recursive: true, force: true });
        fs.mkdirSync(DIR, { recursive: true });

        mem = new Document({ document: { id: "id", index: field(), store: ["name"] } });
        for(const d of DOCS) mem.add(d);

        const client = createClient({ url: "file:" + DIR + "/i.sqlite" });
        const db = new SqliteDB("libsql", { db: libsqlHandle(client) });
        lib = new Document({ document: { id: "id", index: field(), store: ["name"] }, db, commit: false });
        await lib.mount(db);
        for(const d of DOCS) lib.add(d);
        await lib.commit();
    });

    after(function(){
        fs.rmSync(DIR, { recursive: true, force: true });
    });

    it("builds a real database through the injected handle", function(){
        // The adapter imports it lazily and only when no handle was supplied.
        // That node-sqlite3 is never *loaded* cannot be asserted from inside
        // this process: process.moduleLoadList holds Node internals only, so
        // the obvious check passes even after requiring sqlite3. Verify that
        // property by hiding the package instead --
        //   mv node_modules/sqlite3 node_modules/.hidden && node <probe>
        // which also exercises the "no SQLite driver" error raised for a store
        // created without a handle.
        expect(fs.existsSync(DIR + "/i.sqlite")).to.equal(true);
    });

    for(const q of ["honey glazed", "glazed honey", "crispy charred", "spiced candied carrots", "roasted", "honey"]){
        it(`matches the in-memory index on "${q}"`, async function(){
            expect(ids(await lib.search(q, { limit: 20 }))).to.eql(ids(mem.search(q, { limit: 20 })));
        });
    }

    it("keeps writes inside their transaction despite un-awaited run()", async function(){
        // The adapter fires run() without awaiting and expects BEGIN/COMMIT to
        // bracket those writes; the wrapper's FIFO queue is what preserves it.
        lib.add({ id: "late", name: "honey glazed late arrival" });
        await lib.commit();
        expect(ids(await lib.search("late", { limit: 10 }))).to.eql(["late"]);
    });
});
