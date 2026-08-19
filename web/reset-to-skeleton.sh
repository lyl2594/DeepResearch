#!/usr/bin/env bash
# 把 tutorial/web/src 恢复到"骨架初始状态"（未 apply 任何章 web-changes 之前）
# 用法：cd tutorial/web && bash reset-to-skeleton.sh
#
# 什么时候用：
#   - 你 apply 过某章 web-changes 后，想干净地测另一章
#   - 你在 web/src 里做完填空后，想清空重来
#   - 环境被污染想恢复原状
#
# 原理：
#   骨架初始态 = deepResearch 完整业务代码（删了 landing/）= web/src.skeleton-backup/
#   本脚本用 rsync/cp 覆盖 web/src/ 为备份内容。

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKUP_DIR="${SCRIPT_DIR}/src.skeleton-backup"
SRC_DIR="${SCRIPT_DIR}/src"

if [ ! -d "${BACKUP_DIR}" ]; then
    echo "[reset] ✗ 找不到骨架备份：${BACKUP_DIR}"
    echo "  该备份由 Phase A 结束时创建，禁止删除。"
    echo "  若已丢失：从 reference-source/deepResearch-aw/web/src 手动重建骨架。"
    exit 1
fi

echo "[reset] → 从 ${BACKUP_DIR} 恢复 ${SRC_DIR}"

# 先删掉 src/（保证完全一致，避免残留文件）
rm -rf "${SRC_DIR}"
cp -r "${BACKUP_DIR}" "${SRC_DIR}"

echo ""
echo "[reset] ✓ 已恢复到骨架初始状态。"
echo "  文件数：$(find "${SRC_DIR}" -type f | wc -l)"
echo ""
echo "  接下来可以："
echo "    • 什么都不做，直接跑 pnpm dev（骨架就是完整业务代码，能跑）"
echo "    • cd ../chapter08_流式服务/web-changes && bash apply-student.sh"
echo "    • cd ../chapterXX/web-changes && bash apply-teacher.sh"
