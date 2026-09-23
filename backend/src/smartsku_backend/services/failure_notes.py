from typing import ClassVar


class FailureNotes:
    """Why the box could not set up a load cell or calibrate a cell, in words for the dashboard and the journal."""

    NOTES: ClassVar[dict[str, str]] = {
        "busy": "Слот занят: в нём идёт другой замер или калибровка",
        "load_cell_failed": "Тензодатчик не отвечает",
        "cell_present": "Ячейка вставлена — выньте её и уберите всё с площадки",
        "no_cell": "Ячейка не вставлена",
        "slot_not_zeroed": "У слота нет нуля — сначала запомните ноль",
        "slot_not_ready": "Слот не настроен — пройдите «Настройку весов»",
        "unstable": "Вес не успокоился за 5 секунд — не трогайте слот во время замера",
        "no_weight_change": "Показания почти не изменились — проверьте, что груз стоит на площадке, и тензодатчик",
        "tag_unsupported": "NFC-метка ячейки не читается",
        "tag_write_failed": "Данные не записались в NFC-метку — ячейку вынули во время записи?",
        "cell_not_tared": "У ячейки нет веса тары — взвесьте её пустой в «Настройке весов»",
    }

    def text(self, reason: str) -> str:
        return self.NOTES.get(reason, reason)
