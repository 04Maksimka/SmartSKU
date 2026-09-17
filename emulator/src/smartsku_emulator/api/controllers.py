from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, status

from smartsku_emulator.api.schemas import (
    BoxView,
    CellView,
    CreateBoxRequest,
    CreateCellRequest,
    GramsRequest,
    InsertCellRequest,
    LockerView,
    PiecesRequest,
)
from smartsku_emulator.domain.model import Fleet, VirtualBox, VirtualCell
from smartsku_emulator.messaging.supervisor import FleetSupervisor


class FleetController:
    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api", tags=["emulator"], route_class=DishkaRoute)
        self.router.add_api_route("/boxes", self.list_boxes, methods=["GET"], response_model=list[BoxView])
        self.router.add_api_route(
            "/boxes", self.create_box, methods=["POST"], response_model=BoxView, status_code=status.HTTP_201_CREATED
        )
        self.router.add_api_route(
            "/boxes/{hardware_id}/lockers/{locker_id}/pull-out",
            self.pull_out,
            methods=["POST"],
            response_model=CellView,
        )
        self.router.add_api_route(
            "/boxes/{hardware_id}/lockers/{locker_id}/insert", self.insert, methods=["POST"], response_model=BoxView
        )
        self.router.add_api_route("/cells", self.list_loose_cells, methods=["GET"], response_model=list[CellView])
        self.router.add_api_route(
            "/cells", self.create_cell, methods=["POST"], response_model=CellView, status_code=status.HTTP_201_CREATED
        )
        self.router.add_api_route("/cells/{nfc_id}/grams", self.add_grams, methods=["POST"], response_model=CellView)
        self.router.add_api_route("/cells/{nfc_id}/pieces", self.add_pieces, methods=["POST"], response_model=CellView)

    async def list_boxes(self, fleet: FromDishka[Fleet]) -> list[BoxView]:
        return [self._box_view(box) for box in fleet.boxes.values()]

    async def create_box(
        self, request: CreateBoxRequest, fleet: FromDishka[Fleet], supervisor: FromDishka[FleetSupervisor]
    ) -> BoxView:
        box = VirtualBox(request.hardware_id, request.lockers_count, box_id=None)
        fleet.add_box(box)
        supervisor.start(box)
        return self._box_view(box)

    async def pull_out(self, hardware_id: str, locker_id: int, fleet: FromDishka[Fleet]) -> CellView:
        return self._cell_view(fleet.pull_out(hardware_id, locker_id))

    async def insert(
        self, hardware_id: str, locker_id: int, request: InsertCellRequest, fleet: FromDishka[Fleet]
    ) -> BoxView:
        fleet.insert(hardware_id, locker_id, request.nfc_id)
        return self._box_view(fleet.box(hardware_id))

    async def list_loose_cells(self, fleet: FromDishka[Fleet]) -> list[CellView]:
        return [self._cell_view(cell) for cell in fleet.loose_cells.values()]

    async def create_cell(self, request: CreateCellRequest, fleet: FromDishka[Fleet]) -> CellView:
        return self._cell_view(fleet.create_cell(request.nfc_id))

    async def add_grams(self, nfc_id: str, request: GramsRequest, fleet: FromDishka[Fleet]) -> CellView:
        return self._cell_view(fleet.add_grams(nfc_id, request.grams))

    async def add_pieces(self, nfc_id: str, request: PiecesRequest, fleet: FromDishka[Fleet]) -> CellView:
        return self._cell_view(fleet.add_pieces(nfc_id, request.pieces))

    def _box_view(self, box: VirtualBox) -> BoxView:
        return BoxView(
            hardware_id=box.hardware_id,
            box_id=box.box_id,
            connected=box.connected,
            lockers=[
                LockerView(
                    locker_id=locker.locker_id,
                    nfc_flag=locker.cell is not None,
                    cell=self._cell_view(locker.cell) if locker.cell else None,
                    calibrated_piece_weight=box.piece_weights.get(locker.cell.nfc_id) if locker.cell else None,
                    pending_calibration=locker.pending_calibration,
                    zeroed=locker.zero_offset is not None,
                    led_color=locker.led_color,
                    screen_number=locker.screen_number,
                )
                for locker in box.lockers.values()
            ],
        )

    def _cell_view(self, cell: VirtualCell) -> CellView:
        return CellView(nfc_id=cell.nfc_id, weight=round(cell.weight, 3))
