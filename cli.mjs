#!/usr/bin/env node

import { EventParser } from "./lib/block.js";
import { parse, renderAST } from "./lib/ast.js";
import { renderHTML } from "./lib/html.js";
import { applyFilter } from "./lib/filter.js";
import { PandocRenderer, PandocParser } from "./lib/pandoc.js";
import { DjotRenderer } from "./lib/djot-renderer.js";
import fs from "fs";
import { performance } from "perf_hooks";

const warn = function(msg, pos) {
  process.stderr.write(msg + (pos ? " at " + pos : "") + "\n");
}

let timing = false;
let options = {sourcePositions: false, warn: warn};
let to = 'html';
let from = 'djot';
let compact = false;
let width = 72;
let toFormats = ["html","ast","astpretty","events","djot","pandoc"];
let fromFormats = ["djot","ast","pandoc"];
let filters = [];

let usage = `djot [OPTIONS] FILE*
Options:
  --to,-t FORMAT       Format to convert to
                       (${toFormats.join("|")})
  --from,-f FORMAT     Format to convert from (${fromFormats.join("|")})
  --filter FILE        Apply filter defined in FILE (may be repeated)
  --compact            Use compact (rather than pretty) JSON
  --width,-w NUMBER    Wrap width for djot output (-1 = compact, 0 = no wrap)
  --sourcepos,-p       Include source positions
  --time               Print parse time to stderr
  --quiet,-q           Suppress warnings
  --help,-h            This usage message
`;
let files = [];

let args = process.argv;
let i = 2;
while (args[i]) {
  let arg = args[i];
  switch (arg) {
    case "--to":
    case "-t":
      i++;
      to = args[i];
      if (!toFormats.includes(to)) {
        process.stderr.write("--to/-t expects " +
          toFormats.join("|") + ", got " + JSON.stringify(to) + "\n");
        process.exit(1);
      }
      break;
    case "--from":
    case "-f":
      i++;
      from = args[i];
      if (!fromFormats.includes(from)) {
        process.stderr.write("--from/-f expects " +
          fromFormats.join("|") + ", got " + JSON.stringify(from) + "\n");
        process.exit(1);
      }
      break;
    case "--filter": {
      i++;
      let fp = args[i];
      if (typeof(fp) !== "string") {
        process.stderr.write("--filter expects a FILE argument\n");
        process.exit(1);
      }
      let filter = fs.readFileSync(fp, "utf8");
      let filterprog = `"use strict"; return ( function() { ${filter} } );`;
      try {
        let compiledFilter = Function(filterprog)();
        filters.push(compiledFilter);
      } catch(err) {
        process.stderr.write("Error loading filter " + fp + ":\n");
        throw(err);
        process.exit(1);
      }
      break;
    }
    case "--compact":
      compact = true;
      break;
    case "--width":
    case "-w":
      i++;
      width = parseInt(args[i]);
      if (typeof width !== "number") {
        process.stdout.write("--width/-w expects a numerical argument\n");
        process.exit(1);
      }
      break;
    case "--sourcepos":
    case "-p":
      options.sourcePositions = true;
      break;
    case "--time":
      timing = true;
      break;
    case "--quiet":
    case "-q":
      options.warn = (msg, pos) => {};
      break;
    case "--help":
    case "-h":
      process.stdout.write(usage);
      process.exit(0);
      break;
    default:
      if (/^-[a-z]{2,}/.test(arg)) { // -ap = -a -p
        for (let i=1; i < arg.length; i++) {
          args.push("-" + arg.substring(i,i+1));
        }
      } else if (/=/.test(arg)) { // --width=10
        arg.split(/=/).forEach(arg => {
          args.push(arg);
        });
      } else if (/^-/.test(arg)) {
        process.stderr.write("Unknown option " + arg + "\n");
        process.exit(1);
      } else {
        files.push(arg);
      }
  }
  i++;
}

let input = "";
if (files.length === 0) {
  files = ["/dev/stdin"];
}
files.forEach(file => {
  try {
    input = input + fs.readFileSync(file, "utf8");
  } catch(err) {
    console.error(err);
    process.exit(1);
  }
});

try {
  if (to === "events") {
    let start = true;
    for (const event of new EventParser(input, warn)) {
      if (start) {
        process.stdout.write("[");
        start = false;
      } else {
        process.stdout.write(",\n ");
      }
      process.stdout.write(`{ startpos: ${event.startpos}, endpos: ${event.endpos}, annot: "${event.annot}" }`);
    }
    console.log("]");
  } else {
    let startTime = performance.now();
    let ast;
    if (from === "djot") {
      ast = parse(input, options);
    } else if (from === "pandoc") {
      ast = new PandocParser(options.warn).parseJSON(input);
    } else if (from === "ast") {
      ast = JSON.parse(input);
    }
    let endTime = performance.now();
    let parseTime = (endTime - startTime).toFixed(1);

    startTime = performance.now();
    filters.forEach(filter => {
      applyFilter(ast, filter);
    });
    endTime = performance.now();
    let filterTime = (endTime - startTime).toFixed(1);

    startTime = performance.now();
    switch (to) {
      case "html":
        process.stdout.write(renderHTML(ast, options));
        break;
      case "djot":
        process.stdout.write((new DjotRenderer(ast, width).render()));
        break;
      case "ast":
        process.stdout.write(JSON.stringify(ast, null, compact ? 0 : 2));
        process.stdout.write("\n");
        break;
      case "astpretty":
        process.stdout.write(renderAST(ast));
        break;
      case "pandoc":
        process.stdout.write(JSON.stringify(new PandocRenderer(ast, warn).toPandoc(),
                null, compact ? 0 : 2));
        process.stdout.write("\n");
        break;
      default:
    }
    endTime = performance.now();
    let renderTime = (endTime - startTime).toFixed(1);

    if (timing) {
      process.stderr.write(`Timings: parse ${parseTime} ms, filter ${filterTime} ms, render ${renderTime} ms\n`);
    }
  }
} catch(err) {
    process.stderr.write(err.toString() + "\n");
    if (err.stack) {
      process.stderr.write(err.stack);
    }
    process.exitcode = 1;
}


process.exitcode = 0;
