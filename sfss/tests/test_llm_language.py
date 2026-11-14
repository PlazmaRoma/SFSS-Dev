"""Инструкция о языке ответа: что именно уходит в LM Studio."""

from types import SimpleNamespace

from app.config import Settings
from app.models.schemas import Source
from app.services import llm_service
from app.services.llm_service import CYRILLIC, NO_DATA, JsonStringStream, LLMService, strip_formulas

SOURCES = [Source(doc_id="NTRS-1", excerpt="Flame spread slows at low oxygen.", page=3)]


class RecordingClient:
    """Подменяет OpenAI-клиент и запоминает промпт вместо похода в LM Studio."""

    def __init__(self, reply="ok") -> None:
        self.messages: list[dict] = []
        self.calls: list[dict] = []
        # Список — ответы по очереди, на каждый вызов следующий
        self.replies = list(reply) if isinstance(reply, list) else None
        self.reply = reply
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.messages = kwargs["messages"]
        self.calls.append(kwargs)
        if self.replies is not None:
            self.reply = self.replies.pop(0)
        if isinstance(self.reply, Exception):
            raise self.reply
        if kwargs.get("stream"):
            # Для потока ответ — список кусков текста
            return iter(
                SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))])
                for piece in self.reply
            )
        choice = SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=self.reply))
        return SimpleNamespace(choices=[choice])


def _service(monkeypatch, reply="ok", **settings) -> tuple[LLMService, RecordingClient]:
    client = RecordingClient(reply)
    monkeypatch.setattr(llm_service, "OpenAI", lambda **_: client)
    return LLMService(settings=Settings(**settings)), client


def test_broken_formula_does_not_reach_the_model():
    source = Source(
        doc_id="NTRS-20130014061-x",
        page=7,
        excerpt=(
            "is given by where, a = ( Wavof K 8Wf f g o ) 1 xo;∞ ; and b = Wwf Wf w o wxw;f f oxo;∞ : (4) "
            "Here g is the gas density, f is the liquid fuel density."
        ),
    )
    context = LLMService.build_context([source], "en")
    assert "8Wf" not in context
    assert "(formula omitted)" in context
    assert "Here g is the gas density, f is the liquid fuel density." in context


def test_lost_symbols_are_removed():
    assert strip_formulas("Here \x1ag is the gas den\xadsity \uf026") == "Here g is the gas density"


def test_conditions_and_numbers_stay():
    for text in (
        "tests in O2 = 21 % at P = 1 atm with heptane droplets",
        "the droplet diameter, Df =D, is a constant",
        "FLEX-264 heptane 0.21 530 3.23 0.67",
    ):
        assert strip_formulas(text) == text


def test_instruction_appended_to_user_prompt(monkeypatch):
    service, client = _service(monkeypatch)
    service.generate("Why?", SOURCES, language="en")
    user = client.messages[-1]["content"]
    assert "in English" in user
    assert "Question: Why?" in user
    # На русском промпте Ministral вставляла в английский ответ [п. 9] и [Нет данных]
    assert not CYRILLIC.search(user + client.messages[0]["content"])


def test_russian_instruction_carries_glossary(monkeypatch):
    service, client = _service(monkeypatch, answer_ru_via_english=False)
    service.generate("Почему?", SOURCES, language="ru")
    assert "microgravity = невесомость" in client.messages[-1]["content"]


def test_no_language_keeps_prompt_unchanged(monkeypatch):
    service, client = _service(monkeypatch)
    service.generate("Почему?", SOURCES)
    user = client.messages[-1]["content"]
    assert user.endswith("Ответь только на основе контекста выше и укажи источники.")


def test_no_data_message_follows_language(monkeypatch):
    service, _ = _service(monkeypatch)
    assert service.generate("Why?", [], language="en").startswith("The indexed documents")
    assert service.generate("Почему?", []).startswith("В проиндексированных")


def test_page_label_follows_language(monkeypatch):
    # Подпись страницы модель переносит в ссылки ответа как есть
    service, client = _service(monkeypatch)
    service.generate("Why?", SOURCES, language="en")
    assert "[NTRS-1, p. 3]" in client.messages[-1]["content"]
    service.generate("Почему?", SOURCES)
    assert "[NTRS-1, стр. 3]" in client.messages[-1]["content"]
    # Русский ответ пишется по-английски, и контекст для него английский
    service, client = _service(monkeypatch, reply=["EN", '{"russian": "RU"}'])
    service.generate("Почему?", SOURCES, language="ru")
    assert "[NTRS-1, p. 3]" in client.calls[0]["messages"][-1]["content"]


def test_english_question_not_translated(monkeypatch):
    service, client = _service(monkeypatch)
    assert service.search_query("Why does BASS-II matter?") == "Why does BASS-II matter?"
    assert client.calls == []


def test_russian_question_translated_for_search(monkeypatch):
    service, client = _service(monkeypatch, reply='{"english": "Why does droplet size matter?"}')
    assert service.search_query("Почему важен размер капли?") == "Why does droplet size matter?"
    # Без схемы ответа модель на 3B отвечала на вопрос вместо перевода
    assert client.calls[0]["response_format"]["type"] == "json_schema"
    assert client.calls[0]["messages"][-1]["content"] == "Query: Почему важен размер капли?"


def test_translation_failure_falls_back_to_question(monkeypatch):
    for reply in (RuntimeError("LM Studio down"), "not json", '{"english": ""}'):
        service, _ = _service(monkeypatch, reply=reply)
        assert service.search_query("Почему?") == "Почему?"


def test_translation_can_be_switched_off(monkeypatch):
    service, client = _service(monkeypatch, translate_queries=False)
    assert service.search_query("Почему?") == "Почему?"
    assert client.calls == []


def test_context_header_uses_short_report_number(monkeypatch):
    # Имя файла в 60 символов модель переписывала в ссылки с ошибками
    service, client = _service(monkeypatch)
    long_id = Source(doc_id="NTRS-20000030678-Cooperative-Research-Projects", excerpt="x", page=97)
    service.generate("Почему?", [long_id])
    assert "[NTRS-20000030678, стр. 97]" in client.messages[-1]["content"]


def test_prompts_carry_no_citation_template(monkeypatch):
    # Шаблон [doc_id, стр. N] модель копировала буквально, вместо номера отчёта
    service, client = _service(monkeypatch)
    service.generate("Why?", SOURCES, language="en")
    prompt = client.messages[0]["content"] + client.messages[-1]["content"]
    assert "doc_id" not in prompt


def test_russian_answer_written_in_english_then_translated(monkeypatch):
    service, client = _service(
        monkeypatch, reply=["Flame spread slows [NTRS-1, p. 3].", '{"russian": "Пламя замедляется [NTRS-1, p. 3]."}']
    )
    answer = service.generate("Почему?", SOURCES, language="ru", english_question="Why?")
    assert answer == "Пламя замедляется [NTRS-1, p. 3]."
    # Ответ пишется на английский вариант вопроса, перевод — со схемой JSON
    assert "Question: Why?" in client.calls[0]["messages"][-1]["content"]
    assert client.calls[1]["response_format"]["type"] == "json_schema"
    assert client.calls[1]["messages"][-1]["content"] == "Text:\nFlame spread slows [NTRS-1, p. 3]."


def test_failed_answer_translation_falls_back_to_direct_russian(monkeypatch):
    service, client = _service(monkeypatch, reply=["English.", "not json", "Прямой ответ."])
    assert service.generate("Почему?", SOURCES, language="ru") == "Прямой ответ."
    assert "microgravity = невесомость" in client.calls[-1]["messages"][-1]["content"]


def test_english_answer_not_translated(monkeypatch):
    service, client = _service(monkeypatch, reply="Answer.")
    assert service.generate("Why?", SOURCES, language="en") == "Answer."
    assert len(client.calls) == 1


def test_stream_english_answer_comes_in_pieces(monkeypatch):
    service, client = _service(monkeypatch, reply=[["Flame ", "slows."]])
    events = list(service.generate_stream("Why?", SOURCES, language="en"))
    assert events == [
        {"type": "stage", "stage": "answering"},
        {"type": "delta", "text": "Flame "},
        {"type": "delta", "text": "slows."},
    ]
    assert client.calls[0]["stream"] is True


def test_stream_russian_answer_streams_the_translation(monkeypatch):
    service, client = _service(
        monkeypatch, reply=["Flame slows.", ['{"rus', 'sian": "Пла', 'мя \\"медленнее\\"', '"}']]
    )
    events = list(service.generate_stream("Почему?", SOURCES, language="ru", english_question="Why?"))
    assert [e for e in events if e["type"] == "stage"] == [
        {"type": "stage", "stage": "answering"},
        {"type": "stage", "stage": "translating"},
    ]
    assert "".join(e["text"] for e in events if e["type"] == "delta") == 'Пламя "медленнее"'
    # Перевод — со схемой JSON, иначе модель дописывала от себя
    assert client.calls[1]["response_format"]["type"] == "json_schema"


def test_stream_falls_back_to_direct_russian_if_translation_gives_nothing(monkeypatch):
    service, client = _service(monkeypatch, reply=["Flame slows.", ["not json"], ["Прямо ", "по-русски."]])
    events = list(service.generate_stream("Почему?", SOURCES, language="ru"))
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Прямо по-русски."
    assert "microgravity = невесомость" in client.calls[-1]["messages"][-1]["content"]


def test_stream_without_sources_says_no_data(monkeypatch):
    service, client = _service(monkeypatch)
    events = list(service.generate_stream("Why?", [], language="en"))
    assert events == [{"type": "delta", "text": NO_DATA["en"]}]
    assert client.calls == []


def test_json_string_stream_decodes_value_split_anywhere():
    raw = '{ "russian" : "При\\u0020давлении \\"p\\"\\nстр. 5" }'
    for size in (1, 2, 3, 7, len(raw)):
        decoder = JsonStringStream("russian")
        text = "".join(decoder.feed(raw[i : i + size]) for i in range(0, len(raw), size))
        assert text == 'При давлении "p"\nстр. 5'
