// Иконка и сведения о программе в exe (без Wine): resedit
const ResEdit = require('resedit'), fs = require('fs');
const [exePath, icoPath, version] = process.argv.slice(2);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [a, b, c] = version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
const strings = { ProductName: 'Мое_граббер', FileDescription: 'Мое_граббер — браузер для скачивания фото', CompanyName: 'Drakkkkon', LegalCopyright: 'Drakkkkon, 2026', OriginalFilename: 'Moe_grabber.exe', InternalName: 'Moe_grabber', FileVersion: version, ProductVersion: version };
for (const lang of vi.getAllLanguagesForStringValues()) vi.setStringValues(lang, strings);
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('exe ok', fs.statSync(exePath).size);
