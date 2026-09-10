// The IndexedDB adapter must work where there is no `window` -- a Web Worker's
// global is `self`, and its `globalThis.indexedDB` is a real implementation.
// The adapter used to read `window.indexedDB` into a module-level const at load
// time, which in a Worker evaluated to `false` permanently.
//
// `window` is deliberately never defined in this file.
import { expect } from "chai";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

global.self = global;
let FlexSearch = await import("../src/bundle.js");
if(FlexSearch.default) FlexSearch = FlexSearch.default;
const { Document, Charset } = FlexSearch;
const IdxDB = (await import("../src/db/indexeddb/index.js")).default;

describe("IndexedDB adapter without `window`", function(){

    it("has no window in this environment", function(){
        expect(typeof window).to.equal("undefined");
        expect(typeof globalThis.indexedDB).to.not.equal("undefined");
    });

    it("mounts and searches", async function(){
        const db = new IdxDB("worker-test");
        const doc = new Document({
            document: {
                id: "id",
                index: [{ field: "name", tokenize: "forward", encoder: Charset.LatinBalance }],
                store: ["name"]
            },
            db,
            commit: false
        });
        await doc.mount(db);
        doc.add({ id: "1", name: "honey glazed carrots" });
        doc.add({ id: "2", name: "smoked chickpea stew" });
        await doc.commit();

        const res = await doc.search("honey", { limit: 10 });
        const ids = (Array.isArray(res) ? res : []).flatMap(g => g.result.map(String));
        expect(ids).to.eql(["1"]);
    });

    it("reports a usable error when no implementation exists", async function(){
        const saved = globalThis.indexedDB;
        delete globalThis.indexedDB;
        try {
            const db = new IdxDB("no-impl");
            let message = "";
            try { await db.open(); } catch(e){ message = String(e.message); }
            expect(message).to.contain("no IndexedDB implementation");
        } finally {
            globalThis.indexedDB = saved;
        }
    });
});
