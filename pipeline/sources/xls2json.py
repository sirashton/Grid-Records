"""Prints an old Excel (.xls) workbook as JSON: [{"name", "rows"}].

ERCOT's fuel mix reports before 2016 are .xls, which Node can't read without
a library; the Actions runner's Python reads them with xlrd (pip install
xlrd). Empty cells are null, dates stay as Excel serial numbers.
"""
import json
import sys

import xlrd

EMPTY = (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK)
book = xlrd.open_workbook(sys.argv[1])
out = []
for sheet in book.sheets():
    rows = []
    for i in range(sheet.nrows):
        rows.append([None if c.ctype in EMPTY else c.value for c in sheet.row(i)])
    out.append({"name": sheet.name, "rows": rows})
json.dump(out, sys.stdout)
