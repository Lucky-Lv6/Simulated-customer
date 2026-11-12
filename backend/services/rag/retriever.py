"""RAG 检索服务 - 知识库检索与语义匹配"""

import json
import math
import re
from typing import Optional
from config.settings import settings


class KnowledgeItem:
    """知识条目"""
    def __init__(self, data: dict):
        self.id: str = data.get("id", "")
        self.category: str = data.get("category", "")
        self.title: str = data.get("title", "")
        self.summary: str = data.get("summary", "")
        self.content: str = data.get("content", "")
        self.tags: list[str] = data.get("tags", [])

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "title": self.title,
            "summary": self.summary,
            "content": self.content,
            "tags": self.tags,
        }


class KnowledgeRetriever:
    """
    知识库检索器。
    支持关键词搜索、分类过滤、相关性评分。
    """

    def __init__(self):
        self._items: list[KnowledgeItem] = []
        self._load_knowledge_base()

    def _load_knowledge_base(self) -> None:
        """加载知识库数据"""
        kb_file = settings.KNOWLEDGE_DIR / "knowledge_base.json"
        if not kb_file.exists():
            return

        try:
            data = json.loads(kb_file.read_text(encoding="utf-8"))
            self._items = [KnowledgeItem(item) for item in data]
        except Exception:
            self._items = []

    def get_categories(self) -> list[dict]:
        """获取所有分类及其条目数"""
        from collections import Counter
        cat_counter = Counter(item.category for item in self._items)

        # 分类元数据
        cat_meta = {
            "feishu": {"name": "飞书产品", "icon": "building", "color": "#3b82f6"},
            "doubao": {"name": "豆包企业版", "icon": "bot", "color": "#8b5cf6"},
            "faq": {"name": "FAQ", "icon": "help", "color": "#06b6d4"},
            "solutions": {"name": "解决方案", "icon": "puzzle", "color": "#10b981"},
        }

        return [
            {
                "id": cat,
                "name": cat_meta.get(cat, {}).get("name", cat),
                "icon": cat_meta.get(cat, {}).get("icon", "file"),
                "color": cat_meta.get(cat, {}).get("color", "#64748b"),
                "count": count,
            }
            for cat, count in cat_counter.most_common()
        ]

    def get_items_by_category(self, category: str) -> list[dict]:
        """获取指定分类的所有条目"""
        return [
            item.to_dict()
            for item in self._items
            if item.category == category
        ]

    def get_all_items(self) -> list[dict]:
        """获取所有条目"""
        return [item.to_dict() for item in self._items]

    def get_item(self, item_id: str) -> Optional[dict]:
        """获取单个条目"""
        for item in self._items:
            if item.id == item_id:
                return item.to_dict()
        return None

    def search(self, query: str, category: str = "", top_k: int = 10) -> list[dict]:
        """
        搜索知识库。
        使用 TF-IDF 风格的词频评分 + 标签匹配 + 标题加权。
        """
        if not query.strip():
            return []

        # 预处理查询
        query_terms = self._tokenize(query)

        # 候选集
        candidates = self._items if not category else [i for i in self._items if i.category == category]

        # 评分
        scored = []
        for item in candidates:
            score = self._compute_relevance(item, query_terms)
            if score > 0:
                scored.append((score, item))

        # 排序并返回
        scored.sort(key=lambda x: x[0], reverse=True)
        top_results = [item.to_dict() for _, item in scored[:top_k]]

        # 为每个结果附加评分
        for result in top_results:
            result["relevance_score"] = round(
                max(s for s, i in scored if i.id == result["id"]), 2
            )

        return top_results

    def retrieve_for_llm(self, query: str, top_k: int = 3, max_chars: int = 1500) -> str:
        """
        检索知识并格式化为 LLM 上下文。
        用于在客户 Agent 对话中注入相关知识。
        """
        results = self.search(query, top_k=top_k)
        if not results:
            return ""

        parts = ["\n## 相关产品知识参考\n"]
        total_chars = 0

        for r in results:
            entry = f"- [{r['title']}]({r['category']}): {r['content'][:300]}"
            if total_chars + len(entry) > max_chars:
                break
            parts.append(entry)
            total_chars += len(entry)

        return "\n".join(parts)

    # ========== 内部方法 ==========

    def _tokenize(self, text: str) -> list[str]:
        """分词"""
        text = text.lower()
        # 中文分词: 按字 + 常用双字词
        tokens = []
        # 提取英文单词和数字
        tokens.extend(re.findall(r'[a-z0-9]+', text))
        # 中文：按字
        for ch in text:
            if '\u4e00' <= ch <= '\u9fff':
                tokens.append(ch)
        # 双字词
        for i in range(len(text) - 1):
            bigram = text[i:i+2]
            if all('\u4e00' <= c <= '\u9fff' for c in bigram):
                tokens.append(bigram)
        # 三元词
        for i in range(len(text) - 2):
            trigram = text[i:i+3]
            if all('\u4e00' <= c <= '\u9fff' for c in trigram):
                tokens.append(trigram)
        return tokens

    def _compute_relevance(self, item: KnowledgeItem, query_terms: list[str]) -> float:
        """
        计算条目与查询的相关性评分。
        加权因子: 标题匹配(3x) > 标签匹配(2x) > 内容匹配(1x) > 摘要匹配(1.5x)
        """
        score = 0.0
        item_text = (item.title + " " + item.summary + " " + item.content + " " + " ".join(item.tags)).lower()

        for term in query_terms:
            # 标题匹配 (3x)
            if term in item.title.lower():
                score += 3.0 * (len(term) / max(len(item.title), 1))
            # 标签匹配 (2x)
            if any(term in tag.lower() for tag in item.tags):
                score += 2.0
            # 摘要匹配 (1.5x)
            if term in item.summary.lower():
                score += 1.5
            # 内容匹配 (1x)
            content_count = item.content.lower().count(term)
            score += min(content_count * 1.0, 5.0)

        # 长度归一化 (防止长文档总是得分高)
        doc_len = len(item_text)
        if doc_len > 0:
            score = score / math.sqrt(doc_len) * 10

        return score

    def get_stats(self) -> dict:
        """获取知识库统计信息"""
        return {
            "total_items": len(self._items),
            "categories": self.get_categories(),
        }


# 全局单例
_retriever: Optional[KnowledgeRetriever] = None


def get_retriever() -> KnowledgeRetriever:
    """获取全局检索器实例"""
    global _retriever
    if _retriever is None:
        _retriever = KnowledgeRetriever()
    return _retriever