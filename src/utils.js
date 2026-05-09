import { __awaiter } from "tslib";
import * as path from 'path';
import * as fs from 'fs';
/**
 * Ensures that a path is absolute. If the path is relative, it will be
 * resolved relative to the vault's base path.
 */
export function ensureAbsolutePath(inputPath, vault) {
    var _a;
    if (!inputPath || inputPath.trim() === '') {
        return '';
    }
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }
    const adapter = vault.adapter;
    const basePath = adapter.basePath || ((_a = adapter.getBasePath) === null || _a === void 0 ? void 0 : _a.call(adapter)) || '';
    return path.join(basePath, inputPath);
}
/**
 * Searches for Vale binary in common installation paths.
 * Returns the path if found, undefined otherwise.
 */
export function findValeInCommonPaths() {
    return __awaiter(this, void 0, void 0, function* () {
        const commonPaths = [
            '/opt/homebrew/bin/vale', // Homebrew on Apple Silicon
            '/usr/local/bin/vale', // Homebrew on Intel Mac
            '/usr/bin/vale', // System-wide installation
            path.join(process.env.HOME || '', '.local/bin/vale'), // User-local installation
        ];
        for (const valePath of commonPaths) {
            try {
                const stat = yield fs.promises.stat(valePath);
                if (stat.isFile()) {
                    return valePath;
                }
            }
            catch (_a) {
                // Path doesn't exist, continue
            }
        }
        return undefined;
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ1dGlscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFHekI7OztHQUdHO0FBQ0gsTUFBTSxVQUFVLGtCQUFrQixDQUFDLFNBQWlCLEVBQUUsS0FBWTs7SUFDaEUsSUFBSSxDQUFDLFNBQVMsSUFBSSxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDMUMsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDL0IsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUE0RCxDQUFDO0lBQ25GLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEtBQUksTUFBQSxPQUFPLENBQUMsV0FBVyx1REFBSSxDQUFBLElBQUksRUFBRSxDQUFDO0lBQ25FLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUM7QUFDeEMsQ0FBQztBQUVEOzs7R0FHRztBQUNILE1BQU0sVUFBZ0IscUJBQXFCOztRQUN6QyxNQUFNLFdBQVcsR0FBRztZQUNsQix3QkFBd0IsRUFBRyw0QkFBNEI7WUFDdkQscUJBQXFCLEVBQU8sd0JBQXdCO1lBQ3BELGVBQWUsRUFBYSwyQkFBMkI7WUFDdkQsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsaUJBQWlCLENBQUMsRUFBRSwwQkFBMEI7U0FDakYsQ0FBQztRQUVGLEtBQUssTUFBTSxRQUFRLElBQUksV0FBVyxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQzlDLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7b0JBQ2xCLE9BQU8sUUFBUSxDQUFDO2dCQUNsQixDQUFDO1lBQ0gsQ0FBQztZQUFDLFdBQU0sQ0FBQztnQkFDUCwrQkFBK0I7WUFDakMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0NBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgVmF1bHQgfSBmcm9tICdvYnNpZGlhbic7XG5cbi8qKlxuICogRW5zdXJlcyB0aGF0IGEgcGF0aCBpcyBhYnNvbHV0ZS4gSWYgdGhlIHBhdGggaXMgcmVsYXRpdmUsIGl0IHdpbGwgYmVcbiAqIHJlc29sdmVkIHJlbGF0aXZlIHRvIHRoZSB2YXVsdCdzIGJhc2UgcGF0aC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuc3VyZUFic29sdXRlUGF0aChpbnB1dFBhdGg6IHN0cmluZywgdmF1bHQ6IFZhdWx0KTogc3RyaW5nIHtcbiAgaWYgKCFpbnB1dFBhdGggfHwgaW5wdXRQYXRoLnRyaW0oKSA9PT0gJycpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cblxuICBpZiAocGF0aC5pc0Fic29sdXRlKGlucHV0UGF0aCkpIHtcbiAgICByZXR1cm4gaW5wdXRQYXRoO1xuICB9XG5cbiAgY29uc3QgYWRhcHRlciA9IHZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZzsgZ2V0QmFzZVBhdGg/OiAoKSA9PiBzdHJpbmcgfTtcbiAgY29uc3QgYmFzZVBhdGggPSBhZGFwdGVyLmJhc2VQYXRoIHx8IGFkYXB0ZXIuZ2V0QmFzZVBhdGg/LigpIHx8ICcnO1xuICByZXR1cm4gcGF0aC5qb2luKGJhc2VQYXRoLCBpbnB1dFBhdGgpO1xufVxuXG4vKipcbiAqIFNlYXJjaGVzIGZvciBWYWxlIGJpbmFyeSBpbiBjb21tb24gaW5zdGFsbGF0aW9uIHBhdGhzLlxuICogUmV0dXJucyB0aGUgcGF0aCBpZiBmb3VuZCwgdW5kZWZpbmVkIG90aGVyd2lzZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmRWYWxlSW5Db21tb25QYXRocygpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBjb21tb25QYXRocyA9IFtcbiAgICAnL29wdC9ob21lYnJldy9iaW4vdmFsZScsICAvLyBIb21lYnJldyBvbiBBcHBsZSBTaWxpY29uXG4gICAgJy91c3IvbG9jYWwvYmluL3ZhbGUnLCAgICAgIC8vIEhvbWVicmV3IG9uIEludGVsIE1hY1xuICAgICcvdXNyL2Jpbi92YWxlJywgICAgICAgICAgICAvLyBTeXN0ZW0td2lkZSBpbnN0YWxsYXRpb25cbiAgICBwYXRoLmpvaW4ocHJvY2Vzcy5lbnYuSE9NRSB8fCAnJywgJy5sb2NhbC9iaW4vdmFsZScpLCAvLyBVc2VyLWxvY2FsIGluc3RhbGxhdGlvblxuICBdO1xuXG4gIGZvciAoY29uc3QgdmFsZVBhdGggb2YgY29tbW9uUGF0aHMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzLnByb21pc2VzLnN0YXQodmFsZVBhdGgpO1xuICAgICAgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgICAgcmV0dXJuIHZhbGVQYXRoO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGF0aCBkb2Vzbid0IGV4aXN0LCBjb250aW51ZVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iXX0=