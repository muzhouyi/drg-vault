import json
import os
import sys
from pathlib import Path

from pylocres import LocresFile

root = Path(__file__).resolve().parents[2]
loc_root = root / '.tools' / 'drg-locres' / 'FSD' / 'Content' / 'Localization' / 'Game'
catalog_path = root / 'drg-vault' / 'dist' / 'catalog.json'
output_path = root / 'drg-vault' / 'dist' / 'localization.json'


def read_locres(path):
    resource = LocresFile()
    resource.read(path)
    return resource


english = read_locres(loc_root / 'en' / 'Game.locres')
chinese = read_locres(loc_root / 'zh-CN' / 'Game.locres')

zh_by_identity = {}
for namespace in chinese:
    for entry in namespace:
        zh_by_identity[(namespace.name, entry.key)] = entry.translation

translations = {}
for namespace in english:
    for entry in namespace:
        target = zh_by_identity.get((namespace.name, entry.key))
        if target and target != entry.translation:
            translations.setdefault(entry.translation, target)


def normalize(text):
    return ' '.join(text.replace('“', '').replace('”', '').replace('"', '').replace("'", '').split()).casefold()


normalized_translations = {}
for source, target in translations.items():
    normalized_translations.setdefault(normalize(source), target)

catalog = json.loads(catalog_path.read_text(encoding='utf-8'))


def localized(text):
    if not text:
        return ''
    direct = translations.get(text)
    if direct:
        return direct
    aliases = {
        'neonband': '霓虹灯带',
        'flaminghot': '热辣火焰',
        'dustrunner': '风尘行者',
        'distant field': '远方原野',
    }
    return normalized_translations.get(normalize(text), '') or aliases.get(normalize(text), '')


matched = {'weapons': 0, 'cores': 0, 'frameworks': 0, 'paints': 0, 'resources': 0}
for weapon in catalog['weapons']:
    weapon['nameZh'] = localized(weapon['name'])
    matched['weapons'] += bool(weapon['nameZh'])
    for item in weapon.get('modules', []):
        item['nameZh'] = localized(item['name'])
        item['descriptionZh'] = localized(item.get('description', ''))
    for item in weapon.get('frameworks', []):
        item['nameZh'] = localized(item['name'])
        matched['frameworks'] += bool(item['nameZh'])

for item in catalog['coreItems']:
    item['nameZh'] = localized(item['name'])
    item['weaponZh'] = localized(item.get('weapon', ''))
    item['descriptionZh'] = localized(item.get('description', ''))
    matched['cores'] += bool(item['nameZh'])

for group in ('commonWeaponPaintJobs', 'uniqueWeaponPaintJobs', 'armorPaintJobs'):
    for item in catalog[group]:
        item['nameZh'] = localized(item['name'])
        matched['paints'] += bool(item['nameZh'])

resource_fallback = {
    'Bismor': '铋晶', 'Enor Pearl': '乌玛珍珠', 'Jadiz': '玉石', 'Croppa': '铜矿',
    'Magnite': '磁铁矿', 'Umanite': '乌玛矿石', 'Yeast Cone': '酵母菌锥',
    'Malt Star': '麦芽星', 'Starch Nut': '淀粉坚果', 'Barley Bulb': '大麦球',
    'Error Cube': '错误方块', 'Blank Matrix Core': '空白矩阵核心', 'Data Cell': '数据单元',
    'Phazyonite': '相位石',
}
for item in catalog['resources']:
    if item['type'] in ('credits', 'perk'):
        item['nameZh'] = item['name']
    else:
        item['nameZh'] = localized(item['name']) or resource_fallback.get(item['name'], '')
    matched['resources'] += bool(item['nameZh'])

catalog['localization'] = {
    'source': 'installed-game-zh-CN',
    'matched': matched,
}
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
output_path.write_text(json.dumps(translations, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'translationPairs': len(translations), 'matched': matched}, ensure_ascii=False))
