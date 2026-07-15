import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lambdaDir = __dirname;
const rootDir = path.resolve(lambdaDir, "..");
const outputPath = path.join(rootDir, "acuitycx-db-proxy.zip");

function log(message) {
  console.log(`[build-lambda] ${message}`);
}

async function build() {
  log("Starting Lambda build process...");

  // 1. Run npm install inside lambda directory to ensure dependencies are installed
  if (!fs.existsSync(path.join(lambdaDir, "node_modules"))) {
    log("node_modules not found in lambda folder. Running npm install...");
    try {
      execSync("npm install --production", { cwd: lambdaDir, stdio: "inherit" });
      log("Dependencies installed successfully.");
    } catch (err) {
      console.error("Failed to install lambda dependencies:", err);
      process.exit(1);
    }
  } else {
    log("node_modules already exists in lambda folder.");
  }

  // 2. Create zip file archive
  log(`Creating archive at: ${outputPath}`);
  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", {
    zlib: { level: 9 }, // Maximum compression
  });

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      const sizeKb = (archive.pointer() / 1024).toFixed(2);
      log(`Archive successfully created. Total size: ${sizeKb} KB`);
      resolve();
    });

    output.on("end", () => {
      log("Data has been drained");
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        log(`Warning: ${err.message}`);
      } else {
        reject(err);
      }
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    // 3. Append files
    log("Adding files to zip...");
    archive.file(path.join(lambdaDir, "index.js"), { name: "index.js" });
    archive.file(path.join(lambdaDir, "db-engine.js"), { name: "db-engine.js" });
    archive.file(path.join(lambdaDir, "package.json"), { name: "package.json" });

    // Look for sql directory in multiple potential locations
    const possibleSqlDirs = [
      path.join(lambdaDir, "sql"),
      path.join(rootDir, "sql"),
      path.join(rootDir, "..", "sql")
    ];
    let sqlDirAdded = false;
    for (const sqlDir of possibleSqlDirs) {
      if (fs.existsSync(sqlDir) && fs.statSync(sqlDir).isDirectory()) {
        log(`Adding sql directory recursively from: ${sqlDir}`);
        archive.directory(sqlDir, "sql");
        sqlDirAdded = true;
        break;
      }
    }
    if (!sqlDirAdded) {
      log("Warning: sql directory containing acuitycx_*.sql files not found.");
    }

    const sqlPath = path.join(rootDir, "../acuitycx.sql");
    if (fs.existsSync(sqlPath)) {
      log("Adding acuitycx.sql to zip...");
      archive.file(sqlPath, { name: "acuitycx.sql" });
    }

    // 4. Append node_modules directory
    const nodeModulesPath = path.join(lambdaDir, "node_modules");
    if (fs.existsSync(nodeModulesPath)) {
      log("Adding node_modules directory recursively...");
      archive.directory(nodeModulesPath, "node_modules");
    } else {
      log("Warning: node_modules directory not found, package will be incomplete.");
    }

    // 5. Finalize archive
    archive.finalize();
  });
}

build().catch((err) => {
  console.error("Lambda build failed:", err);
  process.exit(1);
});
