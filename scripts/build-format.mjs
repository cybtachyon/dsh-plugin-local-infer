import fs from 'node:fs/promises';
import path from 'node:path';

// Define target directory (usually your tsc outDir)
const TARGET_DIRS = [
    'dsh',
    'packages/client/lib',
    'packages/core/lib',
    'packages/providers/lib',
    'packages/service/lib',
    'packages/tool/lib',
    'packages/ui/lib'
].map(dir => path.join(process.cwd(), dir));

async function processDirectory(dir) {
    try {
        // Check if path exists using stat instead of existsSync
        const stat = await fs.stat(dir).catch(() => null);
        if (!stat || !stat.isDirectory()) return;

        const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });

        // Map entries to a list of promises so they run concurrently
        const tasks = entries.map(async (entry) => {
            const currentDir = entry.parentPath || entry.path;
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                return processDirectory(fullPath);
            }

            const isEmitted = entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')
                || entry.name.endsWith('.js.map') || entry.name.endsWith('.d.ts.map');
            if (entry.isFile() && isEmitted) {
                const content = await fs.readFile(fullPath, 'utf8');

                if (!content.endsWith('\n')) {
                    await fs.appendFile(fullPath, '\n', 'utf8');
                }
            }
        });

        // Wait for all files/subdirectories in this folder to complete in parallel
        await Promise.all(tasks);
    } catch (err) {
        console.error(`Error processing directory ${dir}:`, err);
    }
}

// Kick off all root-level directories concurrently
await Promise.all(TARGET_DIRS.map(dir => processDirectory(dir)));
