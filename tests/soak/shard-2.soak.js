import { defineSoakShard } from "../harness/soak.js";

defineSoakShard(2, Number(process.env.SOAK_SHARDS || 4));
