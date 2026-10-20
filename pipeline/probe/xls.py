import xlrd, glob
for f in sorted(glob.glob('/tmp/tx/prev/*.xls')):
    wb = xlrd.open_workbook(f)
    print('=====', f, [ (s.name, s.nrows, s.ncols) for s in wb.sheets()])
    for s in wb.sheets()[:3]:
        for i in range(min(5, s.nrows)):
            print(s.name, [s.cell_value(i, j) for j in range(min(8, s.ncols))], '... ncols', s.ncols)
